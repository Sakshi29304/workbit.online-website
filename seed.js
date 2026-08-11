/**
 * One-time demo data seeder.
 *
 * Run this LOCALLY (not on Elastic Beanstalk) after the 5 DynamoDB tables
 * exist and your AWS CLI credentials are configured (`aws configure`) with
 * permission to write to them:
 *
 *   cd backend
 *   npm install
 *   AWS_REGION=us-east-1 node seed.js
 *
 * It creates the admin + demo user accounts (same credentials as the old
 * front-end-only build) plus a handful of demo tasks/notes/alerts/activity
 * so the admin analytics dashboard has something to show immediately.
 *
 * Safe to re-run: it just overwrites the same demo items.
 */
require('dotenv').config();
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, TABLES } = require('./src/db');
const { uid, nowISO, hashPassword } = require('./src/utils');

function daysAgoISO(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour !== undefined ? hour : Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}
function daysFromNowISO(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour !== undefined ? hour : Math.floor(Math.random() * 10) + 9, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

async function put(table, item) {
  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

async function main() {
  console.log('Seeding TaskSphere demo data into:', TABLES);

  const adminHash = await hashPassword('Admin@123');
  const userHash = await hashPassword('User@123');

  const admin = {
    _id: 'admin_1', username: 'admin', password: adminHash, name: 'Alex Admin',
    email: 'admin@tasksphere.io', phone: '+1 (555) 000-0001', location: 'San Francisco, CA',
    role: 'Admin', online: false, lastSeen: nowISO(), mustChangePassword: false,
    createdBy: null,
    createdAt: daysAgoISO(60, 9), updatedAt: nowISO(),
  };

  const userSeeds = [
    { id: 'user_1', username: 'testuser', name: 'Taylor User', email: 'taylor@tasksphere.io', createdDaysAgo: 55 },
    { id: 'user_2', username: 'jmartinez', name: 'Jordan Martinez', email: 'jordan@tasksphere.io', createdDaysAgo: 42 },
    { id: 'user_3', username: 'schen', name: 'Sam Chen', email: 'sam@tasksphere.io', createdDaysAgo: 30 },
    { id: 'user_4', username: 'rpatel', name: 'Riya Patel', email: 'riya@tasksphere.io', createdDaysAgo: 17 },
    { id: 'user_5', username: 'cwill', name: 'Casey Williams', email: 'casey@tasksphere.io', createdDaysAgo: 5 },
  ];

  const users = [admin, ...userSeeds.map((u) => ({
    _id: u.id, username: u.username, password: userHash, name: u.name, email: u.email,
    phone: '', location: '', role: 'User', online: false, lastSeen: daysAgoISO(1),
    mustChangePassword: false, createdBy: admin._id,
    createdAt: daysAgoISO(u.createdDaysAgo, 9), updatedAt: nowISO(),
  }))];

  for (const u of users) await put(TABLES.USERS, u);
  console.log(`  users: ${users.length}`);

  const titlePool = [
    ['Review Q3 project report', 'Go through the quarterly metrics and compile a summary.'],
    ['Design team sync call', 'Weekly 30-min standup with the design team.'],
    ['Update onboarding docs', 'Revise the onboarding guide based on recent feedback.'],
    ['Sprint planning meeting', 'Plan the next two-week sprint with engineering.'],
    ['Fix dashboard loading bug', 'Investigate the slow initial load on the dashboard.'],
    ['Write release notes', 'Summarize what shipped this sprint for the changelog.'],
    ['Renew SSL certificates', 'Certs expire soon — renew before the deadline.'],
    ['Respond to support backlog', 'Clear out pending customer support tickets.'],
    ['Code review backlog', 'Clear open pull requests.'],
    ['Write unit tests', 'Add coverage for the new task module.'],
  ];
  const priorities = ['low', 'medium', 'high'];
  const tasks = [];
  users.forEach((u, uIdx) => {
    const count = u.role === 'Admin' ? 6 : 5 + (uIdx % 3) * 2;
    for (let i = 0; i < count; i++) {
      const [title, description] = titlePool[Math.floor(Math.random() * titlePool.length)];
      const priority = priorities[Math.floor(Math.random() * priorities.length)];
      const offset = Math.floor(Math.random() * 24) - 18;
      const deadline = offset < 0 ? daysAgoISO(-offset) : daysFromNowISO(offset);
      const isPast = new Date(deadline) < new Date();
      const done = isPast ? Math.random() < 0.78 : Math.random() < 0.1;
      const createdAt = daysAgoISO(Math.abs(offset) + 1 + Math.floor(Math.random() * 3));
      const doneAt = done ? daysAgoISO(Math.max(0, -offset - Math.floor(Math.random() * 2))) : null;
      tasks.push({
        _id: uid('task'), userId: u._id, title, description, priority,
        deadline, done, doneAt, reminderSent: true,
        createdAt, updatedAt: doneAt || createdAt,
      });
    }
  });
  for (const t of tasks) await put(TABLES.TASKS, t);
  console.log(`  tasks: ${tasks.length}`);

  const notes = [
    { _id: uid('note'), userId: 'user_1', title: 'Welcome to TaskSphere 👋',
      body: 'This is your Notes space. Use it for quick thoughts, meeting notes, or anything you want to track.',
      colorIdx: 0, pinned: true, createdAt: daysAgoISO(50), updatedAt: daysAgoISO(50) },
    { _id: uid('note'), userId: 'admin_1', title: 'Admin reminders',
      body: 'Check in with new hires during their first week. Review pending access requests every Friday.',
      colorIdx: 3, pinned: true, createdAt: daysAgoISO(20), updatedAt: daysAgoISO(3) },
  ];
  for (const n of notes) await put(TABLES.NOTES, n);
  console.log(`  notes: ${notes.length}`);

  const alerts = [
    { _id: uid('alert'), userId: 'user_1', sentBy: admin._id, message: 'Welcome aboard! Let us know if you need anything.', severity: 'info', read: true, readAt: daysAgoISO(50), createdAt: daysAgoISO(55) },
    { _id: uid('alert'), userId: 'user_2', sentBy: admin._id, message: 'Reminder: submit your timesheet by Friday.', severity: 'warning', read: false, readAt: null, createdAt: daysAgoISO(2) },
    { _id: uid('alert'), userId: 'user_4', sentBy: admin._id, message: 'Your account access needs re-verification.', severity: 'urgent', read: false, readAt: null, createdAt: daysAgoISO(1) },
  ];
  for (const a of alerts) await put(TABLES.ALERTS, a);
  console.log(`  alerts: ${alerts.length}`);

  const activity = [];
  users.forEach((u) => {
    const logins = 4 + Math.floor(Math.random() * 10);
    for (let i = 0; i < logins; i++) {
      activity.push({ _id: uid('act'), userId: u._id, action: `${u.name} logged in`, createdAt: daysAgoISO(Math.floor(Math.random() * 34)) });
    }
  });
  tasks.filter((t) => t.done).forEach((t) => {
    const owner = users.find((u) => u._id === t.userId);
    activity.push({ _id: uid('act'), userId: t.userId, action: `${owner ? owner.name : 'A user'} completed a task: "${t.title}"`, createdAt: t.doneAt || t.updatedAt });
  });
  for (const a of activity) await put(TABLES.ACTIVITY, a);
  console.log(`  activity: ${activity.length}`);

  const conv1 = {
    _id: 'conv_direct_user_1', type: 'direct', name: null, memberIds: ['user_1'],
    createdBy: admin._id, createdAt: daysAgoISO(4), updatedAt: daysAgoISO(3),
    lastMessage: 'Perfect, thank you!', lastMessageAt: daysAgoISO(3), lastMessageSenderId: 'user_1',
    lastRead: { [admin._id]: daysAgoISO(3), user_1: daysAgoISO(3) },
  };
  const conv2 = {
    _id: 'conv_direct_user_4', type: 'direct', name: null, memberIds: ['user_4'],
    createdBy: 'user_4', createdAt: daysAgoISO(1), updatedAt: daysAgoISO(1),
    lastMessage: 'I think there might be an issue with my last task deadline — can you check?', lastMessageAt: daysAgoISO(1), lastMessageSenderId: 'user_4',
    lastRead: { user_4: daysAgoISO(1) },
  };
  const conv3 = {
    _id: 'conv_group_1', type: 'group', name: 'Design Team', memberIds: [admin._id, 'user_2', 'user_3'],
    createdBy: admin._id, createdAt: daysAgoISO(10), updatedAt: daysAgoISO(2),
    lastMessage: 'Sounds good, see everyone Thursday.', lastMessageAt: daysAgoISO(2), lastMessageSenderId: 'user_3',
    lastRead: { [admin._id]: daysAgoISO(2), user_2: daysAgoISO(2) },
  };
  const conversations = [conv1, conv2, conv3];
  for (const c of conversations) await put(TABLES.CONVERSATIONS, c);
  console.log(`  conversations: ${conversations.length}`);

  const messages = [
    { _id: uid('msg'), conversationId: conv1._id, senderId: 'user_1', senderName: 'Taylor User', senderUsername: 'testuser', senderRole: 'User', body: 'Hi, quick question — can I get access to the shared drive?', createdAt: daysAgoISO(4) },
    { _id: uid('msg'), conversationId: conv1._id, senderId: admin._id, senderName: 'Alex Admin', senderUsername: 'admin', senderRole: 'Admin', body: 'Sure thing, I just granted you access — try again in a minute.', createdAt: daysAgoISO(4) },
    { _id: uid('msg'), conversationId: conv1._id, senderId: 'user_1', senderName: 'Taylor User', senderUsername: 'testuser', senderRole: 'User', body: 'Perfect, thank you!', createdAt: daysAgoISO(3) },

    { _id: uid('msg'), conversationId: conv2._id, senderId: 'user_4', senderName: 'Riya Patel', senderUsername: 'rpatel', senderRole: 'User', body: 'I think there might be an issue with my last task deadline — can you check?', createdAt: daysAgoISO(1) },

    { _id: uid('msg'), conversationId: conv3._id, senderId: admin._id, senderName: 'Alex Admin', senderUsername: 'admin', senderRole: 'Admin', body: 'Hey team, let\'s sync on the new onboarding flow this week.', createdAt: daysAgoISO(10) },
    { _id: uid('msg'), conversationId: conv3._id, senderId: 'user_2', senderName: 'Jordan Martinez', senderUsername: 'jmartinez', senderRole: 'User', body: 'Works for me, Thursday afternoon?', createdAt: daysAgoISO(9) },
    { _id: uid('msg'), conversationId: conv3._id, senderId: 'user_3', senderName: 'Sam Chen', senderUsername: 'schen', senderRole: 'User', body: 'Sounds good, see everyone Thursday.', createdAt: daysAgoISO(2) },
  ];
  for (const m of messages) await put(TABLES.MESSAGES, m);
  console.log(`  messages: ${messages.length}`);

  console.log('\nDone. Log in with admin / Admin@123 or testuser / User@123.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
