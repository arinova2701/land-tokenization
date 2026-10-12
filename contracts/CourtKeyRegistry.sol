// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./ParcelToken.sol";

/**
 * @title  CourtKeyRegistry
 * @notice NyayaChain — Judicially Authenticated Property Freeze Protocol
 *
 * Changes from v1:
 *   Step 1 — Multi-signer quorum: JUDGE + CLERK/REGISTRAR co-signature required.
 *   Step 2 — Pecuniary jurisdiction: declaredValue per parcel vs maxValue per level.
 *   Step 3 — ERC-3643-compatible token: freeze path delegates to ParcelToken agent.
 *   Step 4 — On-chain verification record: checksBitmask in every HistoryEntry.
 */
contract CourtKeyRegistry {

    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ── Roles ─────────────────────────────────────────────────────────────────
    uint8 public constant ROLE_JUDGE     = 1;
    uint8 public constant ROLE_CLERK     = 2;
    uint8 public constant ROLE_REGISTRAR = 3;

    // ── Check bitmask constants (Step 4) ──────────────────────────────────────
    uint256 public constant CHECK_EXPIRY       = 1 << 0;   // order not expired
    uint256 public constant CHECK_REPLAY       = 1 << 1;   // not a replay
    uint256 public constant CHECK_RECOVER      = 1 << 2;   // all signatures recovered
    uint256 public constant CHECK_NO_DUPE      = 1 << 3;   // no duplicate signers
    uint256 public constant CHECK_REGISTRY     = 1 << 4;   // all signers active in registry
    uint256 public constant CHECK_VALIDITY     = 1 << 5;   // all keys within validity window
    uint256 public constant CHECK_JURISDICTION = 1 << 6;   // territorial jurisdiction
    uint256 public constant CHECK_QUORUM_JUDGE = 1 << 7;   // at least 1 JUDGE present
    uint256 public constant CHECK_QUORUM_COSIG = 1 << 8;   // at least 1 CLERK/REGISTRAR present
    uint256 public constant CHECK_NONCE        = 1 << 9;   // nonce valid
    uint256 public constant CHECK_PECUNIARY    = 1 << 10;  // value within court limit
    uint256 public constant CHECK_FROZEN_STATE = 1 << 11;  // token currently frozen (unfreeze)

    // ── Data structures ───────────────────────────────────────────────────────

    struct JudicialKey {
        string  courtName;
        uint256 validFrom;
        uint256 validUntil;
        bool    active;
        uint8   courtLevel;    // 1=Munsif, 2=SubCourt, 3=DistrictCourt, 4=HighCourt
        bytes32 territoryCode; // keccak256 of territory name
        uint8   role;          // ROLE_JUDGE | ROLE_CLERK | ROLE_REGISTRAR
    }

    struct HistoryEntry {
        uint256 timestamp;
        string  caseNumber;
        address signer;          // primary JUDGE address
        bool    isFreezeAction;
        uint256 nonce;
        uint256 checksBitmask;   // Step 4: all passing checks at acceptance time
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address     public admin;
    ParcelToken public parcelToken; // ERC-3643-compatible token contract (Step 3)

    mapping(address  => JudicialKey)    public registry;
    mapping(address  => uint256)        public judgeNonce;          // per-JUDGE sequential counter
    mapping(bytes32  => bool)           public usedOrders;          // secondary replay guard
    mapping(uint256  => bytes32)        public propertyTerritory;   // tokenId => territory code
    mapping(bytes32  => bytes32)        public parentTerritory;     // district => state
    mapping(bytes32  => string)         public territoryName;       // code => human name
    mapping(uint256  => uint256)        public parcelDeclaredValue; // tokenId => value (Step 2)
    mapping(uint8    => uint256)        public courtLevelMaxValue;  // level => max value (Step 2)
    mapping(uint256  => string)         public frozenBy;            // tokenId => case number
    mapping(uint256  => HistoryEntry[]) public freezeHistory;

    uint256 public quorumThreshold; // minimum total signatures required (Step 1)

    // ── Events ────────────────────────────────────────────────────────────────

    event JudgeRegistered(address indexed signer, string courtName, uint8 courtLevel, uint8 role, string territory);
    event OrderAccepted(uint256 indexed tokenId, address indexed signer, string caseNumber, uint256 nonce, uint256 checksBitmask);
    event OrderVacated(uint256 indexed tokenId, address indexed signer, string caseNumber, uint256 nonce, uint256 checksBitmask);
    event PropertyRegistered(uint256 indexed tokenId, string territory, uint256 declaredValue);
    event ParcelDeclaredValueSet(uint256 indexed tokenId, uint256 value);
    event CourtLevelMaxValueSet(uint8 courtLevel, uint256 maxValue);
    event QuorumThresholdSet(uint256 newThreshold);

    // ── Modifier ──────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address parcelTokenAddress) {
        admin       = msg.sender;
        parcelToken = ParcelToken(parcelTokenAddress);
        quorumThreshold = 2; // 1 JUDGE + at least 1 CLERK/REGISTRAR

        // Seed court-level pecuniary limits (Indian Rupees) — Step 2
        courtLevelMaxValue[1] = 300_000;          // Munsif:          ₹3 lakh
        courtLevelMaxValue[2] = 2_500_000;         // Sub Court:       ₹25 lakh
        courtLevelMaxValue[3] = 10_000_000;        // District Court:  ₹1 crore
        courtLevelMaxValue[4] = type(uint256).max; // High Court:      unlimited
    }

    // ── Territory management ──────────────────────────────────────────────────

    function setTerritory(bytes32 code, string calldata name, bytes32 parent) external onlyAdmin {
        territoryName[code] = name;
        if (parent != bytes32(0)) {
            parentTerritory[code] = parent;
        }
    }

    /**
     * @param tokenId       Property token identifier.
     * @param territory     keccak256 territory code.
     * @param declaredValue Parcel value in INR for pecuniary jurisdiction (Step 2).
     */
    function registerProperty(uint256 tokenId, bytes32 territory, uint256 declaredValue) external onlyAdmin {
        propertyTerritory[tokenId]    = territory;
        parcelDeclaredValue[tokenId]  = declaredValue;
        emit PropertyRegistered(tokenId, territoryName[territory], declaredValue);
    }

    function setParcelDeclaredValue(uint256 tokenId, uint256 value) external onlyAdmin {
        parcelDeclaredValue[tokenId] = value;
        emit ParcelDeclaredValueSet(tokenId, value);
    }

    function setCourtLevelMaxValue(uint8 courtLevel, uint256 maxValue) external onlyAdmin {
        courtLevelMaxValue[courtLevel] = maxValue;
        emit CourtLevelMaxValueSet(courtLevel, maxValue);
    }

    function setQuorumThreshold(uint256 threshold) external onlyAdmin {
        require(threshold >= 2, "Quorum threshold must be at least 2");
        quorumThreshold = threshold;
        emit QuorumThresholdSet(threshold);
    }

    // ── Judge management ──────────────────────────────────────────────────────

    /**
     * @param role  ROLE_JUDGE (1), ROLE_CLERK (2), or ROLE_REGISTRAR (3).
     *              REGISTRAR is exempt from territorial jurisdiction checks.
     */
    function registerJudge(
        address signer,
        string calldata courtName,
        uint256 validFrom,
        uint256 validUntil,
        uint8 courtLevel,
        bytes32 territory,
        uint8 role
    ) external onlyAdmin {
        require(
            role == ROLE_JUDGE || role == ROLE_CLERK || role == ROLE_REGISTRAR,
            "Invalid role"
        );
        registry[signer] = JudicialKey({
            courtName:     courtName,
            validFrom:     validFrom,
            validUntil:    validUntil,
            active:        true,
            courtLevel:    courtLevel,
            territoryCode: territory,
            role:          role
        });
        emit JudgeRegistered(signer, courtName, courtLevel, role, territoryName[territory]);
    }

    function revokeJudge(address signer) external onlyAdmin {
        registry[signer].active = false;
    }

    // ── Internal: jurisdiction check ──────────────────────────────────────────

    function _checkJurisdiction(address signer, uint256 tokenId) internal view {
        bytes32 propTerritory  = propertyTerritory[tokenId];
        bytes32 judgTerritory  = registry[signer].territoryCode;
        require(
            judgTerritory == propTerritory ||
            judgTerritory == parentTerritory[propTerritory],
            "Court lacks territorial jurisdiction over this property"
        );
    }

    // ── Internal: multi-signer quorum validation (Step 1) ─────────────────────

    /**
     * Validates all signatures for quorum rules.  Reverts with the first
     * failing check's error message.
     *
     * Rules:
     *   - Total signatures >= quorumThreshold
     *   - No duplicate signers
     *   - Every signer: active in registry, within validity window
     *   - JUDGE and CLERK signers: must satisfy territorial jurisdiction
     *   - REGISTRAR signers: exempt from territorial jurisdiction (national authority)
     *   - At least 1 signer with ROLE_JUDGE
     *   - At least 1 signer with ROLE_CLERK or ROLE_REGISTRAR
     *
     * Returns the primary JUDGE address (first JUDGE encountered) and the
     * accumulated bitmask with all per-signer checks set.
     */
    function _validateSignatures(
        bytes32 orderHash,
        uint256 tokenId,
        bytes[] calldata signatures,
        uint256 bitmask
    ) internal view returns (address judgeAddress, uint256 newBitmask) {
        uint256 count = signatures.length;
        require(count >= quorumThreshold, "Signatures below quorum threshold");

        address[] memory seen = new address[](count);
        uint256 seenCount  = 0;
        uint256 judgeCount = 0;
        uint256 cosigCount = 0;
        judgeAddress       = address(0);

        bytes32 ethHash = orderHash.toEthSignedMessageHash();

        for (uint256 i = 0; i < count; i++) {
            // Signature recovery (reverts on malformed signature)
            address signer = ethHash.recover(signatures[i]);

            // Duplicate check
            for (uint256 j = 0; j < seenCount; j++) {
                require(seen[j] != signer, "Duplicate signer");
            }
            seen[seenCount++] = signer;

            // Registry active check
            JudicialKey storage k = registry[signer];
            require(k.active, "Unregistered or revoked signer");

            // Key validity window
            require(
                block.timestamp >= k.validFrom && block.timestamp <= k.validUntil,
                "Judicial key expired or not yet valid"
            );

            // Territorial jurisdiction (REGISTRAR is exempt — national authority)
            if (k.role != ROLE_REGISTRAR) {
                _checkJurisdiction(signer, tokenId);
            }

            if (k.role == ROLE_JUDGE) {
                judgeCount++;
                if (judgeAddress == address(0)) judgeAddress = signer; // first JUDGE = primary
            } else if (k.role == ROLE_CLERK || k.role == ROLE_REGISTRAR) {
                cosigCount++;
            }
        }

        // All per-signer checks passed — set those bits
        bitmask |= CHECK_RECOVER;
        bitmask |= CHECK_NO_DUPE;
        bitmask |= CHECK_REGISTRY;
        bitmask |= CHECK_VALIDITY;
        bitmask |= CHECK_JURISDICTION;

        require(judgeCount >= 1, "At least one JUDGE signature required");
        bitmask |= CHECK_QUORUM_JUDGE;

        require(cosigCount >= 1, "At least one CLERK or REGISTRAR co-signature required");
        bitmask |= CHECK_QUORUM_COSIG;

        newBitmask = bitmask;
    }

    // ── ERC-3643 token helpers (Step 3) ───────────────────────────────────────

    /**
     * @dev  Each property tokenId maps to a deterministic canonical address
     *       used as the identity key in ParcelToken.
     */
    function _propertyAddress(uint256 tokenId) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("parcel", tokenId)))));
    }

    // ── freeze status (read-through to ParcelToken) ───────────────────────────

    function frozen(uint256 tokenId) public view returns (bool) {
        return parcelToken.isFrozen(_propertyAddress(tokenId));
    }

    // ── Core freeze ───────────────────────────────────────────────────────────

    function submitFreezeOrder(
        uint256          tokenId,
        string calldata  caseNumber,
        bytes32          orderHash,
        uint256          orderExpiry,
        uint256          nonce,
        bytes[] calldata signatures
    ) external {
        uint256 bitmask = 0;

        // Check 1: order expiry
        require(block.timestamp <= orderExpiry, "Order has expired");
        bitmask |= CHECK_EXPIRY;

        // Check 2: replay protection (secondary — nonce is primary)
        require(!usedOrders[orderHash], "Order already submitted");
        bitmask |= CHECK_REPLAY;

        // Checks 3–9: multi-signer quorum (Step 1)
        address judgeAddress;
        (judgeAddress, bitmask) = _validateSignatures(orderHash, tokenId, signatures, bitmask);

        // Check 10: per-judge nonce sequencing (primary replay/ordering protection)
        require(nonce == judgeNonce[judgeAddress], "Invalid nonce");
        bitmask |= CHECK_NONCE;

        // Check 11: pecuniary jurisdiction (Step 2)
        require(
            parcelDeclaredValue[tokenId] <= courtLevelMaxValue[registry[judgeAddress].courtLevel],
            "Parcel value exceeds court pecuniary limit"
        );
        bitmask |= CHECK_PECUNIARY;

        // Commit state
        usedOrders[orderHash] = true;
        judgeNonce[judgeAddress]++;
        frozenBy[tokenId] = caseNumber;

        // Step 3: delegate freeze to ERC-3643-compatible token
        parcelToken.setAddressFrozen(_propertyAddress(tokenId), true);

        // Step 4: store bitmask in history
        freezeHistory[tokenId].push(HistoryEntry({
            timestamp:     block.timestamp,
            caseNumber:    caseNumber,
            signer:        judgeAddress,
            isFreezeAction: true,
            nonce:         nonce,
            checksBitmask: bitmask
        }));

        emit OrderAccepted(tokenId, judgeAddress, caseNumber, nonce, bitmask);
    }

    // ── Unfreeze (vacate injunction) ──────────────────────────────────────────

    function submitUnfreezeOrder(
        uint256          tokenId,
        string calldata  caseNumber,
        bytes32          orderHash,
        uint256          orderExpiry,
        uint256          nonce,
        bytes[] calldata signatures
    ) external {
        uint256 bitmask = 0;

        // Check 1: order expiry
        require(block.timestamp <= orderExpiry, "Order has expired");
        bitmask |= CHECK_EXPIRY;

        // Check 2: replay protection (secondary — nonce is primary)
        require(!usedOrders[orderHash], "Order already submitted");
        bitmask |= CHECK_REPLAY;

        // Checks 3–9: multi-signer quorum (Step 1)
        address judgeAddress;
        (judgeAddress, bitmask) = _validateSignatures(orderHash, tokenId, signatures, bitmask);

        // Check 10: per-judge nonce sequencing (primary replay/ordering protection)
        require(nonce == judgeNonce[judgeAddress], "Invalid nonce");
        bitmask |= CHECK_NONCE;

        // Check 11: pecuniary jurisdiction (Step 2)
        require(
            parcelDeclaredValue[tokenId] <= courtLevelMaxValue[registry[judgeAddress].courtLevel],
            "Parcel value exceeds court pecuniary limit"
        );
        bitmask |= CHECK_PECUNIARY;

        // Check 12: frozen state (unfreeze only — token must currently be frozen)
        require(frozen(tokenId), "Token is not frozen");
        bitmask |= CHECK_FROZEN_STATE;

        usedOrders[orderHash] = true;
        judgeNonce[judgeAddress]++;
        frozenBy[tokenId] = "";

        parcelToken.setAddressFrozen(_propertyAddress(tokenId), false);

        freezeHistory[tokenId].push(HistoryEntry({
            timestamp:     block.timestamp,
            caseNumber:    caseNumber,
            signer:        judgeAddress,
            isFreezeAction: false,
            nonce:         nonce,
            checksBitmask: bitmask
        }));

        emit OrderVacated(tokenId, judgeAddress, caseNumber, nonce, bitmask);
    }

    // ── On-chain verification record view (Step 4) ────────────────────────────

    /**
     * @notice  Simulate all checks for a prospective order without reverting.
     *          Returns a bitmask of checks that WOULD pass.  A missing bit
     *          indicates the first check that would fail.
     *
     *          The Court portal calls this BEFORE submitting to preview results,
     *          and reads the stored bitmask from history AFTER acceptance.
     *
     *          Revert-reason → failing-step mapping in the frontend is labelled
     *          explicitly as a client-side mapping (not derived from this function).
     */
    function getOrderChecks(
        uint256          tokenId,
        bytes32          orderHash,
        uint256          orderExpiry,
        uint256          nonce,
        bytes[] calldata signatures
    ) external view returns (uint256 bitmask) {
        bitmask = 0;

        // Expiry
        if (block.timestamp > orderExpiry) return bitmask;
        bitmask |= CHECK_EXPIRY;

        // Replay
        if (usedOrders[orderHash]) return bitmask;
        bitmask |= CHECK_REPLAY;

        // Threshold
        if (signatures.length < quorumThreshold) return bitmask;

        bytes32 ethHash = orderHash.toEthSignedMessageHash();

        address[] memory seen = new address[](signatures.length);
        uint256 seenCount    = 0;
        uint256 judgeCount   = 0;
        uint256 cosigCount   = 0;
        bool allRecovered    = true;
        bool noDuplicates    = true;
        bool allRegistered   = true;
        bool allValid        = true;
        bool allJurisdiction = true;
        address judgeAddress = address(0);

        for (uint256 i = 0; i < signatures.length; i++) {
            // Use tryRecover so view function never reverts on bad sig
            (address signer, ECDSA.RecoverError errCode,) = ethHash.tryRecover(signatures[i]);
            if (errCode != ECDSA.RecoverError.NoError) { allRecovered = false; break; }

            // Duplicate check
            bool dupe = false;
            for (uint256 j = 0; j < seenCount; j++) {
                if (seen[j] == signer) { dupe = true; break; }
            }
            if (dupe) { noDuplicates = false; break; }
            seen[seenCount++] = signer;

            // Registry
            JudicialKey storage k = registry[signer];
            if (!k.active) { allRegistered = false; break; }

            // Validity
            if (block.timestamp < k.validFrom || block.timestamp > k.validUntil) {
                allValid = false; break;
            }

            // Jurisdiction (REGISTRAR exempt)
            if (k.role != ROLE_REGISTRAR) {
                bytes32 propTerr = propertyTerritory[tokenId];
                if (k.territoryCode != propTerr && k.territoryCode != parentTerritory[propTerr]) {
                    allJurisdiction = false; break;
                }
            }

            if (k.role == ROLE_JUDGE) {
                judgeCount++;
                if (judgeAddress == address(0)) judgeAddress = signer;
            } else if (k.role == ROLE_CLERK || k.role == ROLE_REGISTRAR) {
                cosigCount++;
            }
        }

        if (!allRecovered)    return bitmask;
        bitmask |= CHECK_RECOVER;

        if (!noDuplicates)    return bitmask;
        bitmask |= CHECK_NO_DUPE;

        if (!allRegistered)   return bitmask;
        bitmask |= CHECK_REGISTRY;

        if (!allValid)        return bitmask;
        bitmask |= CHECK_VALIDITY;

        if (!allJurisdiction) return bitmask;
        bitmask |= CHECK_JURISDICTION;

        if (judgeCount == 0)  return bitmask;
        bitmask |= CHECK_QUORUM_JUDGE;

        if (cosigCount == 0)  return bitmask;
        bitmask |= CHECK_QUORUM_COSIG;

        if (judgeAddress == address(0) || nonce != judgeNonce[judgeAddress]) return bitmask;
        bitmask |= CHECK_NONCE;

        if (parcelDeclaredValue[tokenId] > courtLevelMaxValue[registry[judgeAddress].courtLevel]) return bitmask;
        bitmask |= CHECK_PECUNIARY;
    }

    // ── History query ─────────────────────────────────────────────────────────

    function getFreezeHistoryLength(uint256 tokenId) external view returns (uint256) {
        return freezeHistory[tokenId].length;
    }

    function getFreezeHistoryEntry(uint256 tokenId, uint256 index) external view returns (
        uint256 timestamp,
        string memory caseNumber,
        address signer,
        bool isFreezeAction,
        uint256 nonce,
        uint256 checksBitmask
    ) {
        HistoryEntry storage e = freezeHistory[tokenId][index];
        return (e.timestamp, e.caseNumber, e.signer, e.isFreezeAction, e.nonce, e.checksBitmask);
    }
}
