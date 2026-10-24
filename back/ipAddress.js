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

function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[:-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact)) return null;
  const firstOctet = Number.parseInt(compact.slice(0, 2), 16);
  if ((firstOctet & 1) === 1 || /^0{12}$/.test(compact) || /^f{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g).join(':');
}

function validateAccessAddresses(values, { enabled = true } = {}) {
  if (!Array.isArray(values)) throw new TypeError('Saisissez les adresses IP ou MAC autorisées sous forme de liste.');
  const entries = values.map(value => String(value ?? '').trim()).filter(Boolean);
  if (entries.length > 50) throw new TypeError('La liste est limitée à 50 adresses.');
  if (enabled && entries.length === 0) throw new TypeError('Ajoutez au moins une adresse IP ou MAC avant d’activer la restriction.');
  const normalized = entries.map(value => normalizeIp(value) || normalizeMac(value));
  if (normalized.some(value => !value)) throw new TypeError('Une adresse est invalide. Saisissez une IP sans port/masque ou une adresse MAC au format AA:BB:CC:DD:EE:FF.');
  if (new Set(normalized).size !== normalized.length) throw new TypeError('Chaque adresse IP ou MAC doit être unique.');
  return normalized;
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

module.exports = { parseIp, normalizeIp, normalizeMac, isLocalOrPrivateIp, isPublicIp, validateAllowlist, validateAccessAddresses };
