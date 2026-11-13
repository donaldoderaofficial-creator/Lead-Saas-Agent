const crypto = require('node:crypto');

const OBJECT_CLASSES = new Set(['user', 'computer', 'group', 'printer']);
const ATTRIBUTE_COLUMNS = {
  objectclass: 'object_class',
  id: 'id',
  name: 'name',
  department: 'department',
  oudn: 'ou_dn',
  username: 'username',
  email: 'email',
  phone: 'phone',
  title: 'title',
  hostname: 'hostname',
  assettag: 'asset_tag',
  operatingsystem: 'operating_system',
  serialnumber: 'serial_number',
  location: 'location',
  description: 'description',
  members: 'members_json',
};
const OBJECT_FIELDS = [
  'name',
  'department',
  'ouDn',
  'username',
  'email',
  'phone',
  'title',
  'hostname',
  'assetTag',
  'operatingSystem',
  'serialNumber',
  'location',
  'description',
  'members',
];
const FIELD_LIMITS = {
  name: 200,
  department: 100,
  ouDn: 256,
  username: 128,
  email: 254,
  phone: 40,
  title: 120,
  hostname: 128,
  assetTag: 100,
  operatingSystem: 120,
  serialNumber: 120,
  location: 160,
  description: 1000,
};

class DirectoryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DirectoryValidationError';
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DirectoryValidationError('Directory object must be a JSON object');
  }
}

function validateDn(value, { requireOu = false } = {}) {
  if (typeof value !== 'string' || value.length > 256 || !value.trim()) {
    throw new DirectoryValidationError('base and ouDn must be valid distinguished names');
  }
  const parts = value.split(',');
  const valid = parts.every((part) => /^(OU|CN|DC)=[A-Za-z0-9][A-Za-z0-9 ._@-]{0,62}$/i.test(part.trim()));
  if (!valid || (requireOu && !parts.some((part) => /^OU=/i.test(part.trim())))) {
    throw new DirectoryValidationError('DN must contain valid OU, CN, or DC components');
  }
  return parts.map((part) => part.trim()).join(',');
}

function validateDirectoryObject(input) {
  assertPlainObject(input);
  const allowedFields = new Set(['objectClass', ...OBJECT_FIELDS]);
  const unknownFields = Object.keys(input).filter((key) => !allowedFields.has(key));
  if (unknownFields.length) {
    throw new DirectoryValidationError(`Unsupported directory attributes: ${unknownFields.join(', ')}`);
  }

  const objectClass = typeof input.objectClass === 'string' ? input.objectClass.toLowerCase() : '';
  if (!OBJECT_CLASSES.has(objectClass)) {
    throw new DirectoryValidationError(`objectClass must be one of ${[...OBJECT_CLASSES].join(', ')}`);
  }

  const result = { objectClass };
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS)) {
    const value = input[field];
    if (value === undefined || value === null || value === '') {
      result[field] = null;
      continue;
    }
    if (typeof value !== 'string' || value.length > maxLength || !value.trim()) {
      throw new DirectoryValidationError(`${field} must be a non-empty string of at most ${maxLength} characters`);
    }
    result[field] = field === 'ouDn' ? validateDn(value, { requireOu: true }) : value.trim();
  }

  const members = input.members;
  if (members === undefined || members === null) {
    result.members = [];
  } else {
    if (!Array.isArray(members) || members.length > 50 || members.some((entry) => (
      typeof entry !== 'string' || !entry.trim() || entry.length > 200
    ))) {
      throw new DirectoryValidationError('members must be an array of up to 50 non-empty strings');
    }
    result.members = [...new Set(members.map((entry) => entry.trim()))];
  }

  for (const field of ['name', 'department', 'ouDn']) {
    if (!result[field]) throw new DirectoryValidationError(`${field} is required`);
  }

  return result;
}

function parseDirectoryFilter(filter = '') {
  if (filter === undefined || filter === null || filter === '') return { sql: '1 = 1', params: [] };
  if (typeof filter !== 'string' || filter.length > 512) {
    throw new DirectoryValidationError('filter must be a string of 512 characters or fewer');
  }

  let index = 0;
  const parseNode = () => {
    if (filter[index] !== '(') throw new DirectoryValidationError('Invalid LDAP filter syntax');
    index += 1;
    const operator = filter[index];
    if (operator === '&' || operator === '|') {
      index += 1;
      const children = [];
      while (filter[index] === '(') children.push(parseNode());
      if (children.length < 2 || filter[index] !== ')') {
        throw new DirectoryValidationError('LDAP AND/OR filters require at least two valid expressions');
      }
      index += 1;
      return {
        sql: `(${children.map((child) => child.sql).join(operator === '&' ? ' AND ' : ' OR ')})`,
        params: children.flatMap((child) => child.params),
      };
    }
    if (operator === '!') {
      index += 1;
      const child = parseNode();
      if (filter[index] !== ')') throw new DirectoryValidationError('LDAP NOT filters require one expression');
      index += 1;
      return { sql: `(NOT ${child.sql})`, params: child.params };
    }

    const equalsAt = filter.indexOf('=', index);
    if (equalsAt < 0) throw new DirectoryValidationError('LDAP filters must use equality expressions');
    const attribute = filter.slice(index, equalsAt);
    const column = ATTRIBUTE_COLUMNS[attribute.toLowerCase()];
    if (!column || attribute.length > 40) {
      throw new DirectoryValidationError(`Unsupported directory filter attribute: ${attribute}`);
    }
    index = equalsAt + 1;
    let rawValue = '';
    let hasEscape = false;
    while (index < filter.length && filter[index] !== ')') {
      if (filter[index] === '\\') {
        const hex = filter.slice(index + 1, index + 3);
        if (!/^[0-9a-f]{2}$/i.test(hex)) throw new DirectoryValidationError('LDAP escapes must use two hexadecimal digits');
        rawValue += String.fromCharCode(parseInt(hex, 16));
        hasEscape = true;
        index += 3;
        continue;
      }
      if (filter[index] === '(' || (filter[index] === '*' && filter[index + 1] !== ')')) {
        throw new DirectoryValidationError('Unescaped parentheses and wildcard filters are not supported');
      }
      rawValue += filter[index];
      index += 1;
    }
    if (filter[index] !== ')' || rawValue.length > 200) {
      throw new DirectoryValidationError('LDAP filter value is invalid or too long');
    }
    index += 1;
    const presenceFilter = rawValue === '*' && !hasEscape;

    if (column === 'members_json') {
      if (!presenceFilter) throw new DirectoryValidationError('Only presence filters are supported for members');
      return { sql: `${column} <> '[]'`, params: [] };
    }
    if (presenceFilter) return { sql: `(${column} IS NOT NULL AND ${column} <> '')`, params: [] };
    if (column === 'object_class') rawValue = rawValue.toLowerCase();
    return { sql: `${column} = ? COLLATE NOCASE`, params: [rawValue] };
  };

  const result = parseNode();
  if (index !== filter.length) throw new DirectoryValidationError('Unexpected data after LDAP filter');
  return result;
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return 50;
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DirectoryValidationError('limit must be an integer between 1 and 100');
  }
  return limit;
}

function buildSecurityGuide() {
  return {
    title: 'IT Security Rule Book',
    scope: 'Operational guidance only. This SaaS directory is not an Active Directory controller and does not apply Group Policy or change domain access.',
    osiLayers: [
      { layer: 1, name: 'Physical', control: 'Restrict and inventory access to server rooms, endpoints, and network equipment.' },
      { layer: 2, name: 'Data link', control: 'Use managed switching, segmentation, secure Wi-Fi, and port protections.' },
      { layer: 3, name: 'Network', control: 'Limit routed access with firewalls and network ACLs; keep DC and DNS paths explicit.' },
      { layer: 4, name: 'Transport', control: 'Permit only required TCP/UDP services between clients, domain controllers, and applications.' },
      { layer: 5, name: 'Session', control: 'Use authenticated sessions, short-lived access, and secure session termination.' },
      { layer: 6, name: 'Presentation', control: 'Protect data in transit with current TLS and validate encoded input consistently.' },
      { layer: 7, name: 'Application', control: 'Enforce least privilege, MFA, application validation, audit trails, and timely patching.' },
    ],
    policies: [
      { name: 'Finance workstation lock', setting: 'Interactive logon: Machine inactivity limit', intent: 'Lock unattended screens after the approved idle interval.' },
      { name: 'Removable storage restriction', setting: 'Removable Storage Access: Deny all access', intent: 'Block removable storage where Finance policy requires it.' },
      { name: 'Finance shared drive', setting: 'Group Policy Preferences: Drive Maps', intent: 'Map approved shares to the authorized Finance group.' },
    ],
    directoryProtection: [
      'Keep Domain Admin membership small, reviewed, and separate from everyday accounts.',
      'Patch and monitor domain controllers; protect backups and the NTDS database with restricted, audited access.',
      'Reduce Kerberoasting exposure with managed service accounts, strong unique service credentials, and least privilege; monitor unusual service-ticket requests.',
      'Protect the KRBTGT secret and use the domain recovery procedure after a confirmed golden-ticket or domain-controller compromise.',
      'Use AD-integrated DNS SRV records and healthy time synchronization for reliable domain-controller discovery and Kerberos.',
    ],
    lockoutTriage: {
      policyAction: 'If an enforced Group Policy or access rule denies the requested action, keep that control in place. Do not bypass the policy or grant access; confirm scope with the policy owner.',
      kerberosAction: 'For evidence of a Kerberos failure, preserve the access policy and have an authorized domain administrator check client/DC time synchronization, DNS SRV records and DC locator, domain-controller reachability, service principal names, ticket state, and replication health before correcting the cause and retrying sign-in.',
      limitation: 'This guide does not diagnose a live account, clear tickets, unlock accounts, modify Group Policy, or change Active Directory.',
    },
  };
}

function createItDirectoryService({ directory }) {
  return {
    createObject(input, actorId) {
      const validated = validateDirectoryObject(input);
      return directory.create({ id: crypto.randomUUID(), ...validated }, actorId);
    },

    search({ base, filter, limit } = {}) {
      const where = [];
      const params = [];
      if (base !== undefined && base !== '') {
        const normalizedBase = validateDn(base).toLowerCase();
        const reversedBase = [...normalizedBase].reverse().join('');
        // Reversing the DN turns its subtree into an indexed prefix range.
        where.push('(ou_dn_key >= ? COLLATE NOCASE AND ou_dn_key < ? COLLATE NOCASE)');
        params.push(reversedBase, `${reversedBase},\uffff`);
      }
      const parsedFilter = parseDirectoryFilter(filter);
      where.push(parsedFilter.sql);
      params.push(...parsedFilter.params);
      const boundedLimit = parseLimit(limit);
      return { results: directory.search({ whereSql: where.join(' AND '), params, limit: boundedLimit }), limit: boundedLimit };
    },

    getObject(id) {
      return directory.get(id);
    },

    updateObject(id, input, actorId) {
      assertPlainObject(input);
      const current = directory.get(id);
      if (!current) return undefined;
      if (input.objectClass !== undefined && String(input.objectClass).toLowerCase() !== current.objectClass) {
        throw new DirectoryValidationError('objectClass cannot be changed');
      }
      const allowedFields = new Set(OBJECT_FIELDS);
      const unknownFields = Object.keys(input).filter((key) => key !== 'objectClass' && !allowedFields.has(key));
      if (unknownFields.length) {
        throw new DirectoryValidationError(`Unsupported directory attributes: ${unknownFields.join(', ')}`);
      }
      const merged = { objectClass: current.objectClass };
      for (const field of OBJECT_FIELDS) merged[field] = input[field] === undefined ? current[field] : input[field];
      const validated = validateDirectoryObject(merged);
      const changedFields = Object.keys(input).filter((key) => key !== 'objectClass');
      if (!changedFields.length) return current;
      return directory.update({ id, ...validated }, actorId, changedFields);
    },

    listAudit(id) {
      return directory.listAudit(id);
    },

    getSecurityGuide: buildSecurityGuide,
  };
}

module.exports = {
  createItDirectoryService,
  DirectoryValidationError,
  parseDirectoryFilter,
  validateDirectoryObject,
};
