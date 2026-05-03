// ── Bridge Script Template ─��────────────────────────────────────────
// JavaScript injected into dynamic plugin iframes. Provides the
// window.pixelCity API for state management, tool handling, and
// host communication via postMessage.

/** Build the bridge script with initial state and context baked in. */
export function buildBridgeScript(
  initialState: Record<string, unknown>,
  initialContext: { agentIds: string[]; agentNames: Record<string, string>; buildingId: string | null; activeAgentId: string | null },
): string {
  return `<script>
(function() {
  var pending = {};
  var callIdCounter = 0;
  var currentState = ${JSON.stringify(initialState)};

  function postToParent(type, payload) {
    parent.postMessage(Object.assign({ __pixelCity: true, type: type }, payload), '*');
  }

  function callHost(action, params) {
    var callId = ++callIdCounter;
    return new Promise(function(resolve, reject) {
      pending[callId] = { resolve: resolve, reject: reject };
      postToParent('host-action', { callId: callId, action: action, params: params });
      setTimeout(function() {
        if (pending[callId]) {
          delete pending[callId];
          reject(new Error('Host action timed out: ' + action));
        }
      }, 10000);
    });
  }

  var stateListeners = [];
  var contextListeners = [];
  var toolCallHandler = null;

  window.pixelCity = {
    getState: function() { return currentState; },
    setState: function(value) {
      currentState = value;
      postToParent('state-set', { value: value });
    },
    // onStateChange: assign a callback OR call as a function to subscribe
    onStateChange: function(cb) { stateListeners.push(cb); return function() { stateListeners = stateListeners.filter(function(l) { return l !== cb; }); }; },

    context: ${JSON.stringify(initialContext)},
    onContextChange: function(cb) { contextListeners.push(cb); return function() { contextListeners = contextListeners.filter(function(l) { return l !== cb; }); }; },

    showNotification: function(msg, level) { return callHost('showNotification', { msg: msg, level: level }); },
    selectAgent: function(agentId) { return callHost('selectAgent', { agentId: agentId }); },
    switchToPlugin: function(pluginId) { return callHost('switchToPlugin', { pluginId: pluginId }); },
    sendPtyInput: function(agentId, message, pressEnter) { return callHost('sendPtyInput', { agentId: agentId, message: message, pressEnter: pressEnter !== false }); },
    listAgents: function() { return callHost('listAgents', {}); },

    // onToolCall: assign a callback OR call as a function
    onToolCall: function(cb) { toolCallHandler = cb; }
  };

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.__pixelCity) return;
    var msg = e.data;
    switch (msg.type) {
      case 'state-update':
        currentState = msg.state;
        stateListeners.forEach(function(cb) {
          try { cb(msg.state); } catch(err) { console.error('[PixelCity Bridge] onStateChange error:', err); }
        });
        break;
      case 'context-update':
        window.pixelCity.context = msg.context;
        contextListeners.forEach(function(cb) {
          try { cb(msg.context); } catch(err) { console.error('[PixelCity Bridge] onContextChange error:', err); }
        });
        break;
      case 'tool-call':
        if (toolCallHandler) {
          Promise.resolve()
            .then(function() { return toolCallHandler(msg.toolName, msg.params); })
            .then(function(result) { postToParent('tool-response', { callId: msg.callId, result: result }); })
            .catch(function(err) { postToParent('tool-response', { callId: msg.callId, error: err.message || String(err) }); });
        } else {
          postToParent('tool-response', { callId: msg.callId, error: 'No tool handler registered (onToolCall is null)' });
        }
        break;
      case 'action-response':
        var p = pending[msg.callId];
        if (p) {
          delete pending[msg.callId];
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
        break;
    }
  });

  postToParent('ready', {});
})();
</script>
`
}
