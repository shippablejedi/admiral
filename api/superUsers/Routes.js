'use strict';

module.exports = superUserRoutes;
var validateAccount = require('../../common/auth/validateAccount.js');

function superUserRoutes(app) {
  app.post('/api/superusers', validateAccount, require('./post.js'));
  app.get('/api/superusers', validateAccount, require('./get.js'));
  app.delete('/api/superusers/:superUserId', validateAccount,
    require('./delete.js'));
}
