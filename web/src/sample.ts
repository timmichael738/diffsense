/** A realistic diff with a few planted problems, so visitors can try Diffsense instantly. */
export const SAMPLE_DIFF = `diff --git a/src/routes/users.ts b/src/routes/users.ts
index 3f2a1c4..9b7e2d1 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -1,18 +1,34 @@
 import { Router } from 'express';
 import { db } from '../db';
+import { sendEmail } from '../email';

 export const users = Router();

-users.get('/users/:id', async (req, res) => {
-  const user = await db.query('SELECT id, name FROM users WHERE id = $1', [req.params.id]);
-  res.json(user.rows[0]);
+users.get('/users/search', async (req, res) => {
+  const term = req.query.q;
+  const result = await db.query(\`SELECT * FROM users WHERE name LIKE '%\${term}%'\`);
+  res.json(result.rows);
+});
+
+users.post('/users/:id/invite', async (req, res) => {
+  const user = (await db.query('SELECT * FROM users WHERE id = $1', [req.params.id])).rows[0];
+  for (let i = 0; i <= req.body.emails.length; i++) {
+    sendEmail(req.body.emails[i], \`\${user.name} invited you!\`);
+  }
+  res.status(201).json({ invited: req.body.emails.length });
 });

-users.delete('/users/:id', requireAdmin, async (req, res) => {
+users.delete('/users/:id', async (req, res) => {
   await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
   res.status(204).end();
 });
`;
