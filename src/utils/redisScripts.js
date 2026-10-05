/**
 * DropVault Redis Lua Scripts (V1-T09).
 * Guarantees atomic operations for access state management per CON-1 and CON-2.
 */

/**
 * Atomic download increment with limit check (RED-2, CON-2).
 *
 * Atomically increments the download counter for a share and checks whether
 * the new count exceeds maxDownloads.
 *
 * KEYS[1]: Counter key, e.g. `share:<shareId>:downloads`
 * ARGV[1]: maxDownloads limit (integer >= 1)
 * ARGV[2]: Optional TTL in seconds (applied if key has no TTL)
 *
 * Returns:
 *   >= 1 : New download count if within limit (count <= limit)
 *   -1   : Download limit exceeded (count > limit)
 */
const INCR_DOWNLOAD_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
local limit = tonumber(ARGV[1])
if ARGV[2] and tonumber(ARGV[2]) > 0 then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl == -1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  end
end
if current > limit then
  return -1
end
return current
`;

/**
 * Fallback atomic GETDEL script for Redis versions prior to 6.2 (RED-1, CON-1).
 *
 * KEYS[1]: Key to retrieve and delete
 *
 * Returns:
 *   Prior value if key existed, or nil/null if key was missing
 */
const GETDEL_LUA = `
local val = redis.call('GET', KEYS[1])
if val then
  redis.call('DEL', KEYS[1])
end
return val
`;

module.exports = {
  INCR_DOWNLOAD_LIMIT_LUA,
  GETDEL_LUA,
};
