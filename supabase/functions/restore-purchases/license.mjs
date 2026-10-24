// Server-only Ed25519 signer. Deliberately no hardware id, activation count or expiry.
// payload is signed as exact UTF-8 bytes; clients must verify before parsing it.
export async function signInventory(inventory, jwk, keyId) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(keyId || '')) throw new Error('Invalid signing key id');
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d) throw new Error('Private Ed25519 key required');
  if (inventory.schema_version !== 1 || !inventory.account_id || !Array.isArray(inventory.items)) throw new Error('Invalid inventory');
  const payload = JSON.stringify({ issuer: 'lightning-store', ...inventory });
  const key = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(payload)));
  const encoded = btoa(String.fromCharCode(...signature)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
  return { algorithm: 'Ed25519', key_id: keyId, payload, signature: encoded };
}
