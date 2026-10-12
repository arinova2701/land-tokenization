// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title  ParcelToken
 * @notice ERC-3643-compatible subset
 *
 * This contract implements the freeze surface of the ERC-3643 Restricted Token
 * Standard (T-REX) as a minimal compatible subset.  It provides:
 *
 *   - agent role        — only the designated agent (CourtKeyRegistry) may freeze
 *   - setAddressFrozen  — address-level (full) freeze / unfreeze
 *   - freezePartialTokens / unfreezePartialTokens — partial-amount freeze
 *   - isFrozen          — freeze status query
 *   - canTransfer       — identity/compliance check; blocks frozen addresses
 *
 * Scope: freeze governance only.  Token balances, transfer mechanics, and the
 * full T-REX identity/compliance registry are outside this subset's scope.
 *
 * Labelled "ERC-3643-compatible subset" in code, docs, and the paper.
 */
contract ParcelToken {

    address public owner;
    address public agent; // set to CourtKeyRegistry after deployment

    mapping(address => bool)    private _frozenAddresses;
    mapping(address => uint256) private _frozenTokens;   // partial-freeze amounts

    // ── Events (ERC-3643 compatible) ─────────────────────────────────────────
    event AddressFrozen(address indexed addr, bool indexed isFrozen, address indexed agent);
    event TokensFrozen(address indexed addr, uint256 amount);
    event TokensUnfrozen(address indexed addr, uint256 amount);
    event AgentSet(address indexed newAgent);

    modifier onlyOwner() {
        require(msg.sender == owner, "ParcelToken: not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "ParcelToken: caller is not agent");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ── Agent management ─────────────────────────────────────────────────────

    function setAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "ParcelToken: zero agent");
        agent = newAgent;
        emit AgentSet(newAgent);
    }

    // ── ERC-3643 freeze surface ───────────────────────────────────────────────

    /**
     * @notice Freeze or unfreeze all tokens associated with `addr`.
     * @dev    Only callable by the designated agent (CourtKeyRegistry).
     */
    function setAddressFrozen(address addr, bool frozen) external onlyAgent {
        _frozenAddresses[addr] = frozen;
        emit AddressFrozen(addr, frozen, msg.sender);
    }

    /**
     * @notice Increase the partial-freeze amount for `addr` by `amount`.
     */
    function freezePartialTokens(address addr, uint256 amount) external onlyAgent {
        _frozenTokens[addr] += amount;
        emit TokensFrozen(addr, amount);
    }

    /**
     * @notice Decrease the partial-freeze amount for `addr` by `amount`.
     */
    function unfreezePartialTokens(address addr, uint256 amount) external onlyAgent {
        require(_frozenTokens[addr] >= amount, "ParcelToken: not enough frozen tokens");
        unchecked { _frozenTokens[addr] -= amount; }
        emit TokensUnfrozen(addr, amount);
    }

    /**
     * @notice Returns true if the address-level freeze is active for `addr`.
     */
    function isFrozen(address addr) external view returns (bool) {
        return _frozenAddresses[addr];
    }

    /**
     * @notice Returns the partial-freeze amount held for `addr`.
     */
    function getFrozenTokens(address addr) external view returns (uint256) {
        return _frozenTokens[addr];
    }

    // ── Identity / compliance check (ERC-3643-compatible) ─────────────────────
    /**
     * @notice  Returns false if either `from` or `to` is address-frozen.
     *          In a full T-REX deployment this would query the identity registry.
     *          Here it enforces the minimal restriction: frozen addresses cannot
     *          send or receive tokens.
     */
    function canTransfer(address from, address to, uint256 /*amount*/) external view returns (bool) {
        return !_frozenAddresses[from] && !_frozenAddresses[to];
    }
}
