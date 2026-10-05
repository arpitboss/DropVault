const net = require('net');

/**
 * Validates whether a given string is a valid IPv4, IPv6, or CIDR range notation.
 *
 * Supported formats:
 * - IPv4: 192.168.1.1, 10.0.0.1
 * - IPv4 CIDR: 192.168.1.0/24, 10.0.0.0/8 (prefix 0-32)
 * - IPv6: ::1, 2001:db8::1, fe80::1
 * - IPv6 CIDR: 2001:db8::/32, fe80::/64 (prefix 0-128)
 *
 * @param {*} entry
 * @returns {boolean}
 */
function isValidIpOrCidr(entry) {
  if (typeof entry !== 'string') return false;
  const trimmed = entry.trim();
  if (!trimmed) return false;

  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length !== 2) return false;
    const [ip, prefixStr] = parts;
    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefixStr !== String(prefix)) return false;

    const ipVersion = net.isIP(ip);
    if (ipVersion === 4) {
      return prefix >= 0 && prefix <= 32;
    }
    if (ipVersion === 6) {
      return prefix >= 0 && prefix <= 128;
    }
    return false;
  }

  return net.isIP(trimmed) !== 0;
}

/**
 * Validates an array of IP or CIDR strings.
 *
 * @param {*} arr
 * @returns {boolean}
 */
function validateIpArray(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.every((entry) => isValidIpOrCidr(entry));
}

/**
 * Normalizes an IP address (stripping IPv4-mapped IPv6 prefix `::ffff:`).
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  let trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.substring(7);
  }
  return trimmed;
}

/**
 * Converts an IPv4 string to a 32-bit unsigned integer.
 * @param {string} ip
 * @returns {number}
 */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0) >>> 0;
}

/**
 * Checks if an IPv4 address falls within a given IPv4 CIDR range.
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
function isIpv4InCidr(ip, cidr) {
  const [netIp, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(netIp) & mask);
}

/**
 * Expands and converts an IPv6 string to a 128-bit BigInt.
 * @param {string} ip
 * @returns {bigint}
 */
function ipv6ToBigInt(ip) {
  let fullIp = ip;
  if (fullIp.includes('::')) {
    const [left, right] = fullIp.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    const middle = Array(missing).fill('0');
    fullIp = [...leftParts, ...middle, ...rightParts].join(':');
  }
  const parts = fullIp.split(':').map((p) => p || '0');
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) + BigInt(parseInt(part, 16));
  }
  return result;
}

/**
 * Checks if an IPv6 address falls within a given IPv6 CIDR range.
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
function isIpv6InCidr(ip, cidr) {
  const [netIp, prefixStr] = cidr.split('/');
  const prefix = BigInt(prefixStr);
  const clientInt = ipv6ToBigInt(ip);
  const netInt = ipv6ToBigInt(netIp);
  const shift = 128n - prefix;
  return (clientInt >> shift) === (netInt >> shift);
}

/**
 * Checks if a client IP address matches any IP or CIDR in the given list.
 *
 * @param {string} clientIp - Client IP address (raw or normalized)
 * @param {string[]} list - Array of IP addresses or CIDR notations
 * @returns {boolean} true if clientIp matches any entry in list
 */
function isIpInList(clientIp, list) {
  if (!clientIp || !Array.isArray(list) || list.length === 0) return false;
  const normalizedClient = normalizeIp(clientIp);
  const clientVersion = net.isIP(normalizedClient);
  if (clientVersion === 0) return false;

  return list.some((entry) => {
    if (typeof entry !== 'string') return false;
    const trimmed = entry.trim();
    if (!trimmed.includes('/')) {
      return normalizeIp(trimmed) === normalizedClient;
    }

    const [netIp] = trimmed.split('/');
    const entryVersion = net.isIP(netIp);
    if (entryVersion !== clientVersion) return false;

    if (clientVersion === 4) {
      return isIpv4InCidr(normalizedClient, trimmed);
    } else {
      return isIpv6InCidr(normalizedClient, trimmed);
    }
  });
}

module.exports = {
  isValidIpOrCidr,
  validateIpArray,
  normalizeIp,
  isIpInList,
};
