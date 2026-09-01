*** Begin Patch
*** Update File: workers/receive-with-notifications.ts
@@
-  if (!mailboxId) {
-    await receiveEmail({ raw: new Response(raw).body!, rawSize: raw.byteLength, to: event.to }, env, ctx);
-    return;
-  }
+  if (!mailboxId) {
+    await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
+    return;
+  }
@@
-  if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
-    await receiveEmail({ raw: new Response(raw).body!, rawSize: raw.byteLength, to: event.to }, env, ctx);
-    return;
-  }
+  if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
+    await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
+    return;
+  }
@@
-  await receiveEmail({ raw: new Response(raw).body!, rawSize: raw.byteLength, to: event.to }, env, ctx);
+  await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
*** End Patch
