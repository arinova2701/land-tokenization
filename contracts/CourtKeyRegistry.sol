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
    }

    address public admin;

    mapping(address => JudicialKey) public registry;
    mapping(uint256 => bool) public frozen;
    mapping(uint256 => string) public frozenBy; // stores case number that froze it

    event JudgeRegistered(address indexed signer, string courtName);
    event OrderAccepted(uint256 indexed tokenId, address indexed signer, string caseNumber);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

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

    function submitFreezeOrder(
        uint256 tokenId,
        string calldata caseNumber,
        bytes32 orderHash,
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
        frozenBy[tokenId] = caseNumber;
        emit OrderAccepted(tokenId, recoveredSigner, caseNumber);
    }
}
