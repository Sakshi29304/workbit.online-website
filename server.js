require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { router: authRouter } = require('./src/routes/auth');
const { router: tasksRouter } = require('./src/routes/tasks');
const { router: notesRouter } = require('./src/routes/notes');
const { router: usersRouter } = require('./src/routes/users');
const { router: alertsRouter } = require('./src/routes/alerts');
const { router: adminRouter } = require('./src/routes/admin');
const { router: messagesRouter } = require('./src/routes/messages');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(
  cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

// Elastic Beanstalk's load balancer health check hits "/".
app.get('/', (req, res) => res.status(200).send('TaskSphere API is running.'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use('/auth', authRouter);
app.use('/tasks', tasksRouter);
app.use('/notes', notesRouter);
app.use('/users', usersRouter);
app.use('/alerts', alertsRouter);
app.use('/admin', adminRouter);
app.use('/messages', messagesRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.path}` });
});

// Central error handler — logs full detail to CloudWatch, returns a safe message.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`TaskSphere API listening on port ${PORT}`);
});
