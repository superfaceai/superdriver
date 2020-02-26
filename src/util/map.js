import Debug from 'debug';
import _get from 'lodash.get'
import * as mapping from './mappingSpec'

const debug = Debug('superdriver:map');

/**
 * Traverse OAS mapping schema object, extracts mapping ids and cursor to the source value
 * 
 * @param {object} obj Mapping schema object
 * @param {array} cursor Array of lodash JSON pointers (path)
 * @returns {array} array of found profileIds together with cursor to their values
 */
function traverseMapping(obj, cursor = []) {
  //debug("f:", JSON.stringify(obj), cursor);
  let results = [];

  // Check if we have a match
  if (mapping.OAS_PROFILE_KEY in obj) {
    results.push({ profileId: obj[mapping.OAS_PROFILE_KEY], cursor: [...cursor] });
    //debug("match: ", results , cursor);
    //debug('inserted:', _.last(results))
  }

  // Recurse into JSON Schema object properties or JSON Schema array items.
  // Look for nested profiles.
  let r;
  if (obj.type === "object") {
    r = processObject(obj, cursor);
  } else if (obj.type === "array") {
    r = processArray(obj, cursor);
  }

  if (r && r.length) results = results.concat(r);

  return results;
}

/**
 * Proces JSON Schema object properties
 *  used by traverseMapping() recursively
 * 
 * @param {obj} obj 
 * @param {array} cursor Array of lodash JSON pointers (path)
 */
function processObject(obj, cursor) {
  let results = [];
  let last = cursor[cursor.length - 1];
  // Iterate the properties, build cursor path in the process
  for (const key in obj.properties) {
    //debug(`processing object '${key}' ...`);
    //debug(`cursor:`, cursor);
    //debug(`last: '${last}'`);
    let localCursor = [...cursor];
    if (last === "") {
      localCursor[localCursor.length - 1] = key;
    } else if (last) {
      localCursor[localCursor.length - 1] = last + "." + key;
    } else {
      localCursor.push(key);
    }
    //debug(`cursor:`, cursor);
    let r = traverseMapping(obj.properties[key], localCursor);
    if (r && r.length) results = results.concat(r);
  }
  //debug("object r", results);
  return results;
}

/**
 * Proces JSON Schema array items
 *  used by traverseMapping() recursively
 * 
 * @param {obj} obj 
 * @param {array} cursor Array of lodash JSON pointers (path)
 */
function processArray(obj, cursor) {
  // According to JSON Schema "items" can be either an object or array, we handle this in this function...

  if (isObject(obj.items)) {
    //debug(`processing array item object ...`);
    cursor.push(""); // Temporary empty path to denote an array value and to be replaced later 
    return traverseMapping(obj.items, cursor);
  }

  for (let item of obj.items) {
    //debug(`processing one array item ...`);
    cursor.push("");  // see comment above
    return traverseMapping(item, cursor);
  }
}

/**
 * Object helper function
 * 
 * @param {any} o 
 * @returns true if o is object, false otherwise
 */
function isObject(o) {
  return typeof o === "object" && o !== null;
}

/**
 * Extract value from data based on the cursor
 * 
 * @param {object} data Data source to extract teh value from
 * @param {array} cursor Array of lodash JSON pointers (path)
 */
function extractValue(data, cursor) {
  //debug('--> ', cursor)
  const value = _get(data, cursor[0]);
  if (Array.isArray(value)) {
    const arrayValue = [];
    // Resolved value is an array, recurse into each "leg"
    for (let element of value) {
      arrayValue.push(extractValue(element, cursor.slice(1)));
    }
    return arrayValue;
  } else {
    // use the value directly
    return value;
  }
}

/**
 * Map provider response to the profile language.
 * 
 * @param {object} mappingSchema Mapping schema object
 * @param {any} responseData Provider response data
 */
function mapResponse(mappingSchema, responseData) {
  // First, find any mappings in the mapping schema and resolve them into array of fully qualified profile ids and JSON Pointer cursor
  //
  // The structure might looks as follows:
  //
  // {
  //   profileId: 'http://supermodel.io/superface/CRM/profile/Customers#RetrieveCustomers/name',
  //   cursor: [ 'companies', 'properties.name.value' ],
  // },
  // {
  //   profileId: 'http://supermodel.io/superface/CRM/profile/Customers#RetrieveCustomers/timestamp',
  //   cursor: [ 'companies', 'properties.name.timestamp' ],
  // }  
  //
  // Where cursor is an array of JSON pointers - paths usable by lodash package. When cursor has multiple elements it indicates that the mapped value
  //  is from within an array, each ponter then needs to be resolved relatively to that array.
  // 
  const valueMapping = traverseMapping(mappingSchema);

  // Iterate all mappings and extract value from the response data
  for (let mapping of valueMapping) {
    // Solve one result at a time 
    let val = extractValue(responseData, mapping.cursor);

    // Extend the value mapping object with the actual valeus
    mapping.value = val;
  }

  return valueMapping;
}

export default mapResponse;