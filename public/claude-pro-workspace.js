// Lazy React island: existing EliteTrade navigation, auth and MT5 APIs stay in charge.
export function createClaudeProWorkspace({state,api}) {
  let generation=0,unmount=null;
  function page() {
    return '<div id="claude-pro-root"><div class="workspace-loading" role="status"><h1>Claude Pro Bot</h1><p>Opening your signal workspace…</p></div></div>';
  }
  async function mount() {
    const serial=++generation,element=document.getElementById('claude-pro-root');
    if(!element)return;
    if(!document.querySelector('[data-claude-pro-style]')) {
      const style=document.createElement('link');style.rel='stylesheet';style.href='/claude-pro-bot.css';style.dataset.claudeProStyle='true';document.head.append(style);
    }
    try {
      const {mountClaudeProBot}=await import('./claude-pro-bot.js');
      if(serial!==generation||!element.isConnected)return;
      unmount=mountClaudeProBot(element,{api,user:state.user,config:state.config});
    } catch {
      if(serial===generation&&element.isConnected)element.innerHTML='<div class="empty"><h1>Claude Pro Bot</h1><p>The workspace could not load. Refresh to try again.</p></div>';
    }
  }
  function dispose() {generation++;unmount?.();unmount=null;}
  return {page,mount,dispose};
}
