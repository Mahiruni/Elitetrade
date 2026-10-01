export function createSupabaseData({ url, key }) {
  const base = String(url || '').replace(/\/$/, '');
  if (!base || !key) throw new Error('Supabase configuration is missing.');

  const headers = (token, extra = {}) => ({
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    'Content-Type': 'application/json',
    ...extra
  });

  async function request(path, { method = 'GET', token = '', body, extraHeaders = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: headers(token, extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = text; }
    }
    if (!response.ok) {
      const message = typeof data === 'object' && data
        ? data.message || data.msg || data.error_description || data.error || data.details
        : '';
      const error = new Error(message || `Supabase request failed (${response.status}).`);
      error.status = response.status;
      error.code = data?.code;
      error.details = data;
      throw error;
    }
    return data;
  }

  const query = (table, search, token) => request(`/rest/v1/${table}?${search}`, { token });
  const one = async (table, search, token) => (await query(table, `${search}&limit=1`, token))?.[0] || null;
  const insert = (table, value, token) => request(`/rest/v1/${table}`, {
    method:'POST', token, body:value, extraHeaders:{ Prefer:'return=representation' }
  });
  const update = (table, search, value, token) => request(`/rest/v1/${table}?${search}`, {
    method:'PATCH', token, body:value, extraHeaders:{ Prefer:'return=representation' }
  });
  const remove = (table, search, token) => request(`/rest/v1/${table}?${search}`, {
    method:'DELETE', token, extraHeaders:{ Prefer:'return=representation' }
  });
  const upsert = (table, search, value, token) => request(`/rest/v1/${table}${search ? `?${search}` : ''}`, {
    method:'POST', token, body:value, extraHeaders:{ Prefer:'resolution=merge-duplicates,return=representation' }
  });
  const rpc = (name, args, token) => request(`/rest/v1/rpc/${name}`, { method:'POST', token, body:args || {} });
  const authUser = token => request('/auth/v1/user', { token });
  const auth = (path, { method='POST', token='', body } = {}) => request(`/auth/v1/${path}`, { method, token, body });

  return { request, query, one, insert, update, remove, upsert, rpc, authUser, auth };
}
