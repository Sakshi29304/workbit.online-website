# 🌐 TaskSphere

**A modern, full-stack task and notification management platform — architected for production on AWS.**

TaskSphere helps users organize tasks, take notes, track alerts, and stay updated in real time. Built with a Node.js/Express backend, Amazon DynamoDB for data storage, and a scalable, serverless-friendly AWS infrastructure for reliability and security.

🔗 **Live demo:** [workbit.online](https://workbit.online)

---

## ✨ Features

- ✅ **Task management** — create, update, delete, and track tasks with due dates and urgency levels
- 📝 **Notes** — quick capture and organization
- 🔔 **Real-time alerts & in-app notifications** via Amazon SNS
- 📧 **Transactional emails** (welcome, password reset, reminders) via Amazon SES
- ⏰ **Scheduled deadline reminders** powered by AWS Lambda + EventBridge
- 👤 **Authentication & role-based admin controls**
- 📊 **Admin dashboard** — user management, activity monitoring, and system stats
- 💬 **Messaging** — in-app conversations between users

---

## 🏗️ Architecture
![Uploading image.png…]()

TaskSphere runs on a fully managed AWS cloud architecture, designed for scalability, security, and observability:

| Layer | Service | Purpose |
|---|---|---|
| DNS | Amazon Route 53 | Domain management |
| CDN | Amazon CloudFront | Global, low-latency content delivery |
| Security | AWS Certificate Manager | SSL/TLS (HTTPS) |
| Static Hosting | Amazon S3 | Static assets & frontend hosting |
| Compute | AWS Elastic Beanstalk | Auto-scaling Node.js/Express backend |
| Database | Amazon DynamoDB | NoSQL store — users, tasks, notes, alerts, activity, messages, conversations |
| Email | Amazon SES | Transactional emails |
| Notifications | Amazon SNS | Push & in-app notifications |
| Scheduled Jobs | AWS Lambda + EventBridge | Deadline reminder checks |
| Access Control | AWS IAM | Least-privilege permissions |
| Monitoring | Amazon CloudWatch | Logs, metrics, alarms, dashboards |

*(See `Architecture.png` in this repo for the full system diagram.)*

---

## 🛠️ Tech Stack

**Frontend:** HTML, CSS, JavaScript
**Backend:** Node.js (v18+), Express
**Database:** Amazon DynamoDB
**Auth:** JWT, bcrypt
**Infrastructure:** AWS Elastic Beanstalk, S3, CloudFront, Route 53, Lambda, SNS, SES, IAM, CloudWatch

---

## 📁 Project Structure

```
tasksphere-2/
├── frontend/                 Static UI — HTML, CSS, JS
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js             Calls the backend API (see API_BASE constant)
├── backend/                  Express REST API — deploy to Elastic Beanstalk
│   ├── server.js
│   ├── seed.js                Run once locally to load demo data into DynamoDB
│   └── src/
│       ├── routes/            auth, tasks, notes, users, alerts, admin, messages
│       ├── middleware/        auth middleware
│       ├── db.js
│       ├── ses.js
│       └── sns.js
├── lambda/
│   └── reminder-checker/      Scheduled Lambda — sends deadline reminders via SNS
├── GUIDE.md                   Full step-by-step AWS Console walkthrough
└── README.md
```

---

## 🚀 Getting Started

1. Read **`GUIDE.md`** and follow it top to bottom — it walks through creating the DynamoDB tables, SNS topic, IAM roles, Elastic Beanstalk environment, Lambda function, and EventBridge schedule, entirely in the AWS Console.
2. Update the `API_BASE` constant in `frontend/js/app.js` with your deployed Elastic Beanstalk URL.
3. Host `frontend/` on S3, CloudFront, Netlify, or your preferred static host.
4. Run `node seed.js` once locally to load demo data into DynamoDB.

### Environment variables (backend)

Copy `backend/.env.example` to `backend/.env` and fill in your AWS resource names/ARNs (DynamoDB tables, SNS topic ARN, SES sender, JWT secret, etc.).

---

## 📡 API Overview

RESTful API implemented in `backend/src/routes/`:

```
POST   /auth/login
POST   /auth/logout
POST   /auth/change-password

GET    /tasks
POST   /tasks
PUT    /tasks/:id
DELETE /tasks/:id

GET    /notes
POST   /notes
PUT    /notes/:id
DELETE /notes/:id

GET    /alerts
PATCH  /alerts/:id/read
PATCH  /alerts/read-all

PUT    /users/profile

GET    /admin/users
POST   /admin/users
GET    /admin/users/:id
PUT    /admin/users/:id/role
DELETE /admin/users/:id
POST   /admin/users/:id/alert
GET    /admin/stats
GET    /admin/monitoring
GET    /admin/activity
```

---

## 🔒 Security Notes

- All traffic served over HTTPS via AWS Certificate Manager.
- IAM roles follow least-privilege access for backend ↔ AWS service communication.
- Passwords hashed with bcrypt; sessions secured with JWT.

---

