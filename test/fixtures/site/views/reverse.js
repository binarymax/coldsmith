// A custom view, loaded from the `views` directory.
//
// Note that views are registered under their *basename including extension*,
// so content selects this one with `view: reverse.js`. That is a quirk of
// Environment#loadViewModule and the golden tests pin it in place.

module.exports = function (env, locals, contents, templates, callback) {
  // `this` is the content plugin instance being rendered.
  var reversed = this.metadata.title.split('').reverse().join('')
  callback(null, Buffer.from('<p>' + reversed + '</p>\n'))
}
