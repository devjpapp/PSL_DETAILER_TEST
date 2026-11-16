# Test checklist

Use fictional data until the deployment and device access policies are approved. Test the production build over localhost or HTTPS. Tests below are a manual checklist; they are not represented as completed browser tests.

## Startup and accounts

- [ ] Follow README instructions on Node 24; setup prints a generated administrator password and starts without a separate database server.
- [ ] Sign in as administrator. Running setup again retains the existing account and data.
- [ ] Create two medrep accounts. Sign in to each in separate browser profiles.
- [ ] Verify incorrect credentials fail; medreps cannot view Settings → Team accounts or update approved HCP/SKU records.
- [ ] Change a password; online sessions expire and sign-in with the new password works.
- [ ] Deactivate a test medrep; the server rejects that account's subsequent sync.

## HCPs and masterlist

- [ ] Download the CSV template. Replace demo fields, import valid rows, and inspect the preview.
- [ ] Reimport an existing source ID with revised contact details. It updates the existing HCP rather than duplicating it.
- [ ] Duplicate source IDs within an import are rejected. Duplicate names with different source IDs remain separate HCPs.
- [ ] Confirm source IDs and explicit Medretailers mappings appear in the directory.
- [ ] As a medrep, add a non-masterlist HCP with contact details, dispensing status, classification, and each institution category.
- [ ] The creator and admin can see that HCP; another medrep cannot. After admin approval and sync, all reps can see it.

## Planning

- [ ] Add calls on multiple dates and times; use daily itinerary, seven-day calendar, and daily Gantt.
- [ ] Reschedule and cancel uncompleted calls. Compare changes in the planner.
- [ ] Start an engagement from a planned call, submit it, and verify the call is completed.
- [ ] Completed calls cannot be rescheduled or cancelled; duplicate completions are rejected.
- [ ] Admin can toggle team calls and inspect rep names. A medrep sees only their own calls.

## Engagement capture

- [ ] Start detailing, add patients seen, notes, one to three gallery images, and draw a signature.
- [ ] Stop the timer; verify duration. Also submit with the timer still running and verify submission stops it.
- [ ] Attempt missing documentation, negative quantities, duplicate sample rows, and duplicate order references; correct the validation messages.
- [ ] Check PNG/JPEG/WebP, the 2 MB image limit, and the three-photo limit on both desktop and your intended mobile device.
- [ ] Add multiple SKUs and quantities, plus multiple comma-separated Medretailers order references.
- [ ] Inspect the saved record and verify planned date, actual date, duration, signature, gallery images, sample details, and unverified order references.
- [ ] Edit an HCP/SKU after a completed sync; the historical engagement snapshot remains unchanged.

## Offline and reconnection — essential

- [ ] Wait for the offline shell and initial sync to finish while online.
- [ ] Disable network access. Reload the page; directory, plans, samples, and saved engagements remain available.
- [ ] Start an engagement draft, attach a photo, draw a signature, close/reopen the app offline, and verify every draft field and timer survives.
- [ ] Create a new non-masterlist HCP offline, then a plan and an engagement referencing it. Save each.
- [ ] Close/reopen offline and confirm saved records and queue still exist.
- [ ] Reconnect with the app open. Confirm automatic sync, preserved actual date, and a distinct server sync date. No manual refresh should be needed.
- [ ] Confirm the administrator sees those records and all images in another browser.
- [ ] Interrupt connectivity during an upload and reconnect. The server should hold exactly one record, with the queue eventually clear.
- [ ] Stop the server while the device still has internet. The app should show server unavailability and retain records; restarting the server should allow a retry.
- [ ] Expire the session or change the password in another browser. Pending work remains; signing back into the same account resumes sync.
- [ ] Test on the actual Android/iOS device and browser to confirm service worker support, storage persistence, file picker, and signature input.

## Conflicts and errors

- [ ] Download the same editable HCP into two browser profiles for the same account. Go offline in one, edit locally, and change/sync the other copy online.
- [ ] Reconnect the offline copy. Sync center should display a conflict without losing the local values.
- [ ] Test “Keep my changes” and “Use server version” separately; verify the resulting server record.
- [ ] Deactivate a SKU while a device with that SKU is offline. Submit an offline sample engagement, reconnect, and verify the rejection is visible and editable.
- [ ] Correct a rejected record or fix its dependency, then retry. Pending work should remain until accepted.
- [ ] Export a local JSON backup. Verify it includes pending records, drafts, and attachments. Keep it outside source control.
- [ ] Attempt sign-out while the queue is nonempty; it should prevent silent loss. After sync, sign out and confirm cached records are cleared.

## Reports

- [ ] Filter by actual date range, representative (admin), masterlist status, institution, and sync status.
- [ ] Compare the displayed engagement, duration, samples, and order counts with the captured records.
- [ ] Export engagements, sample distribution, booked references, and planned-versus-actual CSVs.
- [ ] Confirm dates are exported as ISO timestamps, planned dates are retained, and unverified sales are labeled.
- [ ] Test a value beginning with `=`; spreadsheet exports should escape it as text.

## Deployment

- [ ] Test Docker startup and persistence if Docker is your intended hosting option.
- [ ] Use HTTPS and `COOKIE_SECURE=1` for remote access. Verify offline readiness from the phone's actual URL.
- [ ] Restart the server; records and accounts remain present in the persistent data directory/volume.
- [ ] Verify a database backup and restore process before collecting operational data.

## Business decisions still needed

- Authoritative HCP masterlist owner, format, refresh policy, and stable identifiers.
- Verified Medretailers HCP/order integration contract and credentials.
- Approved sample SKU list; whether inventory, allocations, returns, or batches are required.
- Call targets, non-masterlist credit, approval workflows, and any duration correction policy.
- Expected team size, attachment volume, data retention, and hosting environment.
