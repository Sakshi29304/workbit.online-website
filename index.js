/**
 * TaskSphere reminder-checker Lambda
 *
 * Triggered on a schedule (every 5 minutes) by an EventBridge/CloudWatch
 * Events rule. Scans the Tasks table for tasks whose deadline falls in the
 * next 10 minutes that haven't been reminded about yet, publishes an SNS
 * notification for each, and flags them as reminded so we don't repeat.
 *
 * Environment variables (set in the Lambda console):
 *   TASKS_TABLE     - e.g. TaskSphereTasks
 *   USERS_TABLE     - e.g. TaskSphereUsers
 *   SNS_TOPIC_ARN   - ARN of the TaskSphereAlerts SNS topic
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sns = new SNSClient({});

const TASKS_TABLE = process.env.TASKS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 10 * 60 * 1000); // next 10 minutes

  const { Items: tasks } = await ddb.send(
    new ScanCommand({
      TableName: TASKS_TABLE,
      FilterExpression: '#d = :false AND reminderSent = :false',
      ExpressionAttributeNames: { '#d': 'done' },
      ExpressionAttributeValues: { ':false': false },
    })
  );

  const due = (tasks || []).filter((t) => {
    const dl = new Date(t.deadline);
    return dl >= now && dl <= windowEnd;
  });

  console.log(`Found ${due.length} task(s) due for a reminder.`);

  for (const task of due) {
    let userName = 'A user';
    try {
      const { Item: user } = await ddb.send(
        new GetCommand({ TableName: USERS_TABLE, Key: { _id: task.userId } })
      );
      if (user) userName = user.name;
    } catch (err) {
      console.error('Could not look up user for task', task._id, err.message);
    }

    const message = `Reminder: "${task.title}" is due at ${new Date(task.deadline).toLocaleString()} (assigned to ${userName}).`;

    try {
      if (SNS_TOPIC_ARN) {
        await sns.send(
          new PublishCommand({
            TopicArn: SNS_TOPIC_ARN,
            Subject: 'TaskSphere: upcoming deadline',
            Message: message,
          })
        );
      }
      await ddb.send(
        new UpdateCommand({
          TableName: TASKS_TABLE,
          Key: { _id: task._id },
          UpdateExpression: 'SET reminderSent = :true',
          ExpressionAttributeValues: { ':true': true },
        })
      );
    } catch (err) {
      console.error('Failed to process reminder for task', task._id, err.message);
    }
  }

  return { checked: (tasks || []).length, remindersSent: due.length };
};
