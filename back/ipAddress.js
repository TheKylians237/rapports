'use strict';

const ipaddr = require('ipaddr.js');

function parseIp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    let address = ipaddr.parse(value.trim());
    if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) address = address.toIPv4Address();
    return address;
  } catch {
    return null;
  }
}

function normalizeIp(value) {
  return parseIp(value)?.toString() || null;
}

function isLocalOrPrivateIp(value) {
  const address = typeof value === 'string' ? parseIp(value) : value;
  if (!address) return false;
  return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(address.range());
}

function isPublicIpv6(address) {
  const [first, second] = address.parts;
  const globalUnicast = first >= 0x2000 && first <= 0x3fff;
  const assignedForSpecialUse = first === 0x2001 && second <= 0x01ff;
  const documentationRange = first === 0x3fff && (second & 0xfff0) === 0;
  return globalUnicast && !assignedForSpecialUse && !documentationRange;
}

function isPublicIpv4(address) {
  const [first, second] = address.octets;
  // RFC 2544 benchmarking addresses are returned as unicast by ipaddr.js.
  return !(first === 198 && (second === 18 || second === 19));
}

function isPublicIp(value) {
  const address = typeof value === 'string' ? parseIp(value) : value;
  if (!address) return false;
  if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) return isPublicIp(address.toIPv4Address());
  if (address.range() !== 'unicast') return false;
  return address.kind() === 'ipv6' ? isPublicIpv6(address) : isPublicIpv4(address);
}

function networkKey(address) {
  if (address.kind() === 'ipv4') return `ipv4:${address.octets.slice(0, 3).join('.')}/24`;
  return `ipv6:${address.parts.slice(0, 4).map(part => part.toString(16).padStart(4, '0')).join(':')}/64`;
}

function validateAllowlist(values, { enabled = true } = {}) {
  if (!Array.isArray(values)) throw new TypeError('La liste des adresses IP doit être un tableau.');
  const entries = values.map(value => String(value ?? '').trim()).filter(Boolean);
  if (!enabled && entries.length === 0) return [];
  if (entries.length !== 2) throw new TypeError('Saisissez exactement deux adresses IP publiques.');

  const addresses = entries.map(parseIp);
  if (addresses.some(address => !isPublicIp(address))) {
    throw new TypeError('Les deux adresses doivent être des IP publiques valides, sans port ni masque réseau.');
  }
  const normalized = addresses.map(address => address.toString());
  if (normalized[0] === normalized[1]) throw new TypeError('Les deux adresses IP doivent être différentes.');
  if (networkKey(addresses[0]) === networkKey(addresses[1])) {
    throw new TypeError('Les deux adresses doivent appartenir à des réseaux distincts (/24 en IPv4 ou /64 en IPv6).');
  }
  return normalized;
}

module.exports = { parseIp, normalizeIp, isLocalOrPrivateIp, isPublicIp, validateAllowlist };
