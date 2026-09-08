// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CourtKeyRegistry {

    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct JudicialKey {
        string courtName;      // e.g. "XVI Assistant City Civil Court, Chennai"
        uint256 validFrom;     // unix timestamp
        uint256 validUntil;    // unix timestamp
        bool active;
    }

    address public admin;

    // maps a judge's signing address to their registry entry
    mapping(address => JudicialKey) public registry;

    // maps a token/parcel ID to its frozen status
    mapping(uint256 => bool) public frozen;

    event JudgeRegistered(address indexed signer, string courtName);
    event OrderAccepted(uint256 indexed tokenId, address indexed signer, string caseNumber);
    event OrderRejected(uint256 indexed tokenId, address indexed signer, string reason);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------
    // Registry management
    // ------------------------------------------------------------

    function registerJudge(
        address signer,
        string calldata courtName,
        uint256 validFrom,
        uint256 validUntil
    ) external onlyAdmin {
        registry[signer] = JudicialKey({
            courtName: courtName,
            validFrom: validFrom,
            validUntil: validUntil,
            active: true
        });

        emit JudgeRegistered(signer, courtName);
    }

    function revokeJudge(address signer) external onlyAdmin {
        registry[signer].active = false;
    }

    // ------------------------------------------------------------
    // Core freeze trigger
    // ------------------------------------------------------------

    function submitFreezeOrder(
        uint256 tokenId,
        string calldata caseNumber,
        bytes32 orderHash,     // hash of the off-chain order document
        bytes calldata signature
    ) external {
        address recoveredSigner = orderHash.toEthSignedMessageHash().recover(signature);

        require(registry[recoveredSigner].active, "Unregistered or revoked signer");

        require(
            block.timestamp >= registry[recoveredSigner].validFrom &&
            block.timestamp <= registry[recoveredSigner].validUntil,
            "Judicial key expired or not yet valid"
        );

        frozen[tokenId] = true;
        emit OrderAccepted(tokenId, recoveredSigner, caseNumber);
    }
}