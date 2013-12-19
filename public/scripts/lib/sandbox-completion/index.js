var _          = require('underscore');
var ecma5      = require('./ecma5.json');
var browser    = require('./browser.json');
var fromPath   = require('../from-path');
var middleware = require('../../state/middleware');

/**
 * Recurse through the description structure and attach descriptions to nodes
 * using a `Map` interface.
 *
 * @param  {Map}    map
 * @param  {Object} describe
 * @param  {Object} global
 * @return {Map}
 */
var attachDescriptions = function (map, describe, global) {
  (function recurse (description, context) {
    // Break recursion on a non-Object.
    if (!_.isObject(context)) { return; }

    // Set the map object reference to point to the description.
    map.set(context, description);

    if (_.isObject(description)) {
      // Iterate over the description object and attach more definitions.
      _.each(description, function (describe, key) {
        // Tern.js definitions prepend an exclamation mark to definition types.
        if (key.charAt(0) === '!') { return; }

        var descriptor = Object.getOwnPropertyDescriptor(context, key);

        // We need to use property descriptors here since Firefox throws errors
        // with getters on some prototype properties.
        return descriptor && recurse(describe, descriptor.value);
      });
    }
  })(describe, global);

  return map;
};

/**
 * Accepts a window object and returns an object for use with middleware.
 *
 * @param  {Object} sandbox
 * @return {Object}
 */
module.exports = function (global) {
  var map     = new Map();
  var plugins = {};

  // Attach pre-defined global description objects.
  attachDescriptions(map, ecma5,   global);
  attachDescriptions(map, browser, global);

  /**
   * Middleware plugin for describing native types.
   *
   * @param {Object}   data
   * @param {Function} next
   * @param {Function} done
   */
  plugins['completion:describe'] = function (data, next, done) {
    // TODO: Improve detection of primitives and use the parent context object.
    var description = map.get(data.context);

    // If we didn't find a description, pass the lookup off to the next
    // middleware.
    if (description == null) {
      return next();
    }

    return done(null, description);
  };

  /**
   * Middleware for looking up function return types for native functions.
   *
   * @param {Object}   data
   * @param {Function} next
   * @param {Function} done
   */
  plugins['completion:function'] = function (data, next, done) {
    var constructors = [
      data.window.Array,
      data.window.String,
      data.window.Boolean
    ];

    // Constructor functions are relatively easy to handle.
    if (data.isConstructor || _.contains(constructors, data.context)) {
      return done(null, data.context.prototype);
    }

    // This may be a little dodgy, but as long as someone hasn't extended the
    // native prototype object with something that has side-effects, we'll be
    // fine.
    if (!_.isObject(data.parent)) {
      return done(null, data.context.call(data.parent));
    }

    // Use the documentation to detect the return types.
    middleware.trigger('completion:describe', data, function (err, describe) {
      if (err || !_.isObject(describe) || !/^fn\(/.test(describe['!type'])) {
        return next(err);
      }

      // Split the documentation type and get the return type.
      var returnType = describe['!type'].split(' -> ');

      // Update the return type string.
      returnType = returnType.length > 1 ? returnType.pop() : null;

      if (returnType === 'string') {
        return done(null, data.window.String());
      }

      if (returnType === 'number') {
        return done(null, data.window.Number());
      }

      if (returnType === 'bool') {
        return done(null, data.window.Boolean());
      }

      if (/\[.*\]/.test(returnType)) {
        return done(null, data.window.Array());
      }

      if (returnType === 'fn()') {
        return done(null, data.window.Function());
      }

      // Returns its own instance.
      if (returnType === '!this') {
        return done(null, data.parent);
      }

      // Instance type return.
      if (/^\+/.test(returnType) && data.window[returnType.substr(1)]) {
        return done(
          null,
          fromPath(data.window, returnType.substr(1).split('.')).prototype
        );
      }

      return next();
    });
  };

  return plugins;
};
