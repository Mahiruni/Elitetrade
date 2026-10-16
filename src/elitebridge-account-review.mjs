// Preparation is an administrative routing choice, never broker verification.
// Do not read credentials, provision MetaApi, or create a fake gateway binding.
export function prepareEliteBridgeAccount(account, owner) {
  const fail = message => { const error = new Error(message); error.status = 409; throw error; };
  if (!owner || owner.disabled || (!owner.active && owner.role !== 'admin'))
    fail('Activate the member account before preparing EliteBridge.');
  if (account.gateway_id || account.status === 'connected')
    fail('This account already has a provider binding. Disconnect it intentionally before preparing EliteBridge.');
  const note = 'EliteBridge setup pending: pair an authorized Windows MT5 terminal. Independent broker verification, positions and order execution are not yet available.';
  return {ok:true,provider:'elitebridge',status:'pending',connected:false,
    brokerVerified:false,ordersEnabled:false,nextPath:'/elitebridge',note,
    message:'Prepared for EliteBridge. Open EliteBridge setup to pair a Windows MT5 terminal. The broker account is not connected yet.'};
}
