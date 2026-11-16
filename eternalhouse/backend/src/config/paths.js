'use strict';
// One place that knows where the UI lives. Backend = this folder; UI = ../frontend (override with FRONTEND_DIR).
const path = require('path');
const frontend = path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', '..', 'frontend'));
module.exports = {
  frontend,
  views: path.join(frontend, 'views'),   // EJS page templates
  pub: path.join(frontend, 'public'),    // css/, js/, media/
  media: path.join(frontend, 'public', 'media'),
  data: path.join(__dirname, '..', '..', 'data'),
};
