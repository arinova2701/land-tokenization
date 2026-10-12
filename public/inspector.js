// public/inspector.js — Sprint 0a stub
// Sprint B1 (Vijay) implements the full inspector.
// This stub satisfies the API contract so court.html can load and fire events
// without errors before B1 is merged.
(function () {

  let _container = null;
  let _provider  = null;
  let _config    = null;

  /**
   * Mount the inspector into a DOM container.
   * Must be called once before setOrder.
   *
   * @param {object} opts
   * @param {Element} opts.container  DOM element to render into (e.g. #inspector-root)
   * @param {object}  opts.provider   ethers BrowserProvider
   * @param {object}  opts.config     parsed public/config.json
   */
  function attach({ container, provider, config }) {
    _container = container;
    _provider  = provider;
    _config    = config;
    // stub: no UI rendered yet
  }

  /**
   * Update the inspector with the current order state.
   *
   * @param {object} orderContext
   * @param {object} orderContext.order           { tokenId, action, caseNumber, orderHash, orderExpiry, nonce }
   * @param {Array}  orderContext.signatures       [{ signer, role, signature }] (may be partial)
   * @param {string} orderContext.status          "draft"|"collecting"|"ready"|"submitted"|"accepted"
   * @param {string|null} orderContext.txHash
   * @param {number} orderContext.checksBitmask   stored bitmask after acceptance, 0 before
   */
  function setOrder(orderContext) {
    // stub: no-op until Sprint B1
  }

  window.NyayaInspector = { attach, setOrder };
})();
