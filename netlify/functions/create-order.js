// sanity test: minimal handler
exports.handler = async function () {
  return { statusCode: 200, body: 'create-order OK' };
};
