// -----------------------------------------------------------------------------
// The XML-RPC dialect of Webmin (`/xmlrpc.cgi`), written and read by hand: a
// call is a few lines of XML, an answer a tree of a dozen value types. No
// dependency (an XML library would weigh more than the integration).
//
// What Webmin sends, seen on Webmin 2.670:
//   - integers as <int>, even beyond 32 bits (disk sizes in bytes);
//   - doubles as <double> (load averages, and the Webmin version: "2.670");
//   - empty Perl values as an empty <string>, flags as <int>1</int> or "";
//   - struct members in any order;
//   - a fault as <fault> { faultCode, faultString }, the string sometimes
//     base64-encoded (a Perl error message with new lines).
// -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const escape = (text) =>
  String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

function unescape(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[entity.toLowerCase()] ?? all;
  });
}

function encodeValue(value) {
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(encodeValue).join('')}</data></array></value>`;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return `<value><int>${value}</int></value>`;
  }
  if (typeof value === 'number') {
    return `<value><double>${value}</double></value>`;
  }
  if (typeof value === 'boolean') {
    return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  }
  return `<value><string>${escape(value ?? '')}</string></value>`;
}

/** The body of a call: `encodeCall('proc.get_system_uptime')`. */
export function encodeCall(method, params = []) {
  const encoded = params.map((param) => `<param>${encodeValue(param)}</param>`).join('');
  return `<?xml version="1.0"?>\n<methodCall><methodName>${escape(
    method,
  )}</methodName><params>${encoded}</params></methodCall>`;
}

export class XmlRpcFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlRpcFormatError';
  }
}

export class XmlRpcFault extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'XmlRpcFault';
    this.code = code;
  }
}

/** The tags and texts of a document, without the declaration and comments. */
function tokenize(xml) {
  const tokens = [];
  const pattern = /<(\/?)([A-Za-z][\w.-]*)[^>]*?(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|([^<]+)/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    if (match[2]) {
      if (match[3]) {
        tokens.push({ open: match[2] }, { close: match[2] });
      } else {
        tokens.push(match[1] ? { close: match[2] } : { open: match[2] });
      }
    } else if (match[4] !== undefined) {
      tokens.push({ text: match[4] });
    }
  }
  return tokens;
}

class Reader {
  constructor(tokens) {
    this.tokens = tokens;
    this.at = 0;
  }

  skipBlank() {
    while (this.tokens[this.at]?.text !== undefined && !this.tokens[this.at].text.trim()) {
      this.at += 1;
    }
  }

  peek() {
    this.skipBlank();
    return this.tokens[this.at];
  }

  open(name) {
    const token = this.peek();
    if (token?.open !== name) {
      throw new XmlRpcFormatError(`Expected <${name}>`);
    }
    this.at += 1;
  }

  close(name) {
    const token = this.peek();
    if (token?.close !== name) {
      throw new XmlRpcFormatError(`Expected </${name}>`);
    }
    this.at += 1;
  }

  /** The text up to the closing tag (unescaped), not trimmed. */
  text(name) {
    let text = '';
    while (this.tokens[this.at]?.text !== undefined) {
      text += this.tokens[this.at].text;
      this.at += 1;
    }
    this.close(name);
    return unescape(text);
  }

  value() {
    this.open('value');
    // <value>text</value> without a type is a string; Webmin also puts new
    // lines around a typed value (<value>\n<double>2.670</double>\n</value>).
    const start = this.at;
    const type = this.peek()?.open;
    if (!type) {
      this.at = start;
      return this.text('value');
    }
    this.at += 1;
    let result;
    switch (type) {
      case 'string':
        result = this.text(type);
        break;
      case 'int':
      case 'i4':
      case 'i8':
      case 'double': {
        const raw = this.text(type).trim();
        result = Number(raw);
        if (raw === '' || !Number.isFinite(result)) {
          throw new XmlRpcFormatError(`Not a number: ${raw.slice(0, 20)}`);
        }
        break;
      }
      case 'boolean':
        result = this.text(type).trim() === '1';
        break;
      case 'base64':
        result = Buffer.from(this.text(type).replace(/\s+/g, ''), 'base64').toString('utf8');
        break;
      case 'nil':
        this.close(type);
        result = null;
        break;
      case 'dateTime.iso8601':
        result = this.text(type).trim();
        break;
      case 'array':
        result = this.array();
        break;
      case 'struct':
        result = this.struct();
        break;
      default:
        throw new XmlRpcFormatError(`Unknown value type ${type}`);
    }
    this.close('value');
    return result;
  }

  array() {
    const items = [];
    this.open('data');
    while (this.peek()?.open === 'value') {
      items.push(this.value());
    }
    this.close('data');
    this.close('array');
    return items;
  }

  struct() {
    const members = {};
    while (this.peek()?.open === 'member') {
      this.open('member');
      this.open('name');
      const name = this.text('name').trim();
      const value = this.value();
      this.close('member');
      if (name !== '__proto__') {
        members[name] = value;
      }
    }
    this.close('struct');
    return members;
  }
}

/**
 * The value of a method response.
 * @param {string} xml
 * @returns {unknown}
 * @throws {XmlRpcFault} the server answered with a fault
 * @throws {XmlRpcFormatError} not an XML-RPC response
 */
export function decodeResponse(xml) {
  const reader = new Reader(tokenize(typeof xml === 'string' ? xml : ''));
  reader.open('methodResponse');
  if (reader.peek()?.open === 'fault') {
    reader.open('fault');
    const fault = reader.value();
    const code = Number(fault?.faultCode);
    throw new XmlRpcFault(
      Number.isFinite(code) ? code : 0,
      typeof fault?.faultString === 'string' ? fault.faultString.trim() : 'Unknown fault',
    );
  }
  reader.open('params');
  // A Perl function that returns nothing: no <param> at all.
  if (reader.peek()?.close === 'params') {
    return null;
  }
  reader.open('param');
  const value = reader.value();
  reader.close('param');
  return value;
}
