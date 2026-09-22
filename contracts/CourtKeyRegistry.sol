// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CourtKeyRegistry {

    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct JudicialKey {
        string courtName;
        uint256 validFrom;
        uint256 validUntil;
        bool active;
        uint8 courtLevel;       // 1=Munsif, 2=SubCourt, 3=DistrictCourt, 4=HighCourt
        bytes32 territoryCode;  // keccak256 of territory name
    }

    struct HistoryEntry {
        uint256 timestamp;
        string caseNumber;
        address signer;
        bool isFreezeAction;    // true = freeze, false = unfreeze
        uint256 nonce;
    }

    address public admin;

    mapping(address => JudicialKey) public registry;
    mapping(address => uint256) public judgeNonce;          // per-judge sequential counter
    mapping(uint256 => bool) public frozen;
    mapping(uint256 => string) public frozenBy;
    mapping(bytes32 => bool) public usedOrders;             // secondary replay guard
    mapping(uint256 => bytes32) public propertyTerritory;  // tokenId => territory
    mapping(bytes32 => bytes32) public parentTerritory;     // district => state
    mapping(bytes32 => string) public territoryName;        // code => human-readable name

    // Freeze history: tokenId => array of entries
    mapping(uint256 => HistoryEntry[]) public freezeHistory;

    event JudgeRegistered(address indexed signer, string courtName, uint8 courtLevel, string territory);
    event OrderAccepted(uint256 indexed tokenId, address indexed signer, string caseNumber, uint256 nonce);
    event OrderVacated(uint256 indexed tokenId, address indexed signer, string caseNumber, uint256 nonce);
    event PropertyRegistered(uint256 indexed tokenId, string territory);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ---- Territory management ----

    function setTerritory(bytes32 code, string calldata name, bytes32 parent) external onlyAdmin {
        territoryName[code] = name;
        if (parent != bytes32(0)) {
            parentTerritory[code] = parent;
        }
    }

    function registerProperty(uint256 tokenId, bytes32 territory) external onlyAdmin {
        propertyTerritory[tokenId] = territory;
        emit PropertyRegistered(tokenId, territoryName[territory]);
    }

    // ---- Judge management ----

    function registerJudge(
        address signer,
        string calldata courtName,
        uint256 validFrom,
        uint256 validUntil,
        uint8 courtLevel,
        bytes32 territory
    ) external onlyAdmin {
        registry[signer] = JudicialKey({
            courtName: courtName,
            validFrom: validFrom,
            validUntil: validUntil,
            active: true,
            courtLevel: courtLevel,
            territoryCode: territory
        });
        emit JudgeRegistered(signer, courtName, courtLevel, territoryName[territory]);
    }

    function revokeJudge(address signer) external onlyAdmin {
        registry[signer].active = false;
    }

    // ---- Internal jurisdiction check ----

    function _checkJurisdiction(address signer, uint256 tokenId) internal view {
        bytes32 propTerritory = propertyTerritory[tokenId];
        bytes32 judgTerritory = registry[signer].territoryCode;
        require(
            judgTerritory == propTerritory ||
            judgTerritory == parentTerritory[propTerritory],
            "Court lacks territorial jurisdiction over this property"
        );
    }

    // ---- Core freeze ----

    function submitFreezeOrder(
        uint256 tokenId,
        string calldata caseNumber,
        bytes32 orderHash,
        uint256 orderExpiry,
        uint256 nonce,
        bytes calldata signature
    ) external {
        // Check 1: order expiry
        require(block.timestamp <= orderExpiry, "Order has expired");

        // Check 2: replay protection (secondary — nonce is primary)
        require(!usedOrders[orderHash], "Order already submitted");

        // Check 3: signature recovery
        address recoveredSigner = orderHash.toEthSignedMessageHash().recover(signature);

        // Check 4: registry check
        require(registry[recoveredSigner].active, "Unregistered or revoked signer");

        // Check 5: key validity
        require(
            block.timestamp >= registry[recoveredSigner].validFrom &&
            block.timestamp <= registry[recoveredSigner].validUntil,
            "Judicial key expired or not yet valid"
        );

        // Check 6: territorial jurisdiction
        _checkJurisdiction(recoveredSigner, tokenId);

        // Check 7: nonce sequencing (primary replay/ordering protection)
        require(nonce == judgeNonce[recoveredSigner], "Invalid nonce");

        usedOrders[orderHash] = true;
        judgeNonce[recoveredSigner]++;
        frozen[tokenId] = true;
        frozenBy[tokenId] = caseNumber;

        freezeHistory[tokenId].push(HistoryEntry({
            timestamp: block.timestamp,
            caseNumber: caseNumber,
            signer: recoveredSigner,
            isFreezeAction: true,
            nonce: nonce
        }));

        emit OrderAccepted(tokenId, recoveredSigner, caseNumber, nonce);
    }

    // ---- Unfreeze (vacate injunction) ----

    function submitUnfreezeOrder(
        uint256 tokenId,
        string calldata caseNumber,
        bytes32 orderHash,
        uint256 orderExpiry,
        uint256 nonce,
        bytes calldata signature
    ) external {
        // Check 1: order expiry
        require(block.timestamp <= orderExpiry, "Order has expired");

        // Check 2: replay protection (secondary — nonce is primary)
        require(!usedOrders[orderHash], "Order already submitted");

        // Check 3: signature recovery
        address recoveredSigner = orderHash.toEthSignedMessageHash().recover(signature);

        // Check 4: registry check
        require(registry[recoveredSigner].active, "Unregistered or revoked signer");

        // Check 5: key validity
        require(
            block.timestamp >= registry[recoveredSigner].validFrom &&
            block.timestamp <= registry[recoveredSigner].validUntil,
            "Judicial key expired or not yet valid"
        );

        // Check 6: territorial jurisdiction
        _checkJurisdiction(recoveredSigner, tokenId);

        // Check 7: nonce sequencing
        require(nonce == judgeNonce[recoveredSigner], "Invalid nonce");

        // Additional: token must currently be frozen
        require(frozen[tokenId], "Token is not frozen");

        usedOrders[orderHash] = true;
        judgeNonce[recoveredSigner]++;
        frozen[tokenId] = false;
        frozenBy[tokenId] = "";

        freezeHistory[tokenId].push(HistoryEntry({
            timestamp: block.timestamp,
            caseNumber: caseNumber,
            signer: recoveredSigner,
            isFreezeAction: false,
            nonce: nonce
        }));

        emit OrderVacated(tokenId, recoveredSigner, caseNumber, nonce);
    }

    // ---- History query ----

    function getFreezeHistoryLength(uint256 tokenId) external view returns (uint256) {
        return freezeHistory[tokenId].length;
    }

    function getFreezeHistoryEntry(uint256 tokenId, uint256 index) external view returns (
        uint256 timestamp,
        string memory caseNumber,
        address signer,
        bool isFreezeAction,
        uint256 nonce
    ) {
        HistoryEntry storage e = freezeHistory[tokenId][index];
        return (e.timestamp, e.caseNumber, e.signer, e.isFreezeAction, e.nonce);
    }
}
