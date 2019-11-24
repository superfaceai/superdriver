export let encode

if (typeof btoa === 'function') {
  encode = btoa
} else if (typeof Buffer === 'function') {
  encode = function(value) {
    return new Buffer(value).toString('base64');
  }
} else {
  throw "Can't polyfill base64.encode"
}