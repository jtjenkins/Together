⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/guides/backup-restore).
Please visit the new site for the latest version.

---

# Backup & Restore Guide

This guide covers comprehensive backup and restore procedures for Together, protecting your community data and minimizing downtime.

---

## What Gets Backed Up

Together stores data in two places:

| Component               | Type     | Volume          | Description                                                              |
| ----------------------- | -------- | --------------- | ------------------------------------------------------------------------ |
| **PostgreSQL database** | Database | `postgres_data` | Users, servers, channels, messages, roles, permissions, reactions, polls |
| **File uploads**        | Files    | `uploads_data`  | User-uploaded images and files (up to 50 MB per file)                    |

**Important:** Both volumes must be backed up for a complete restore. Database dumps alone won't restore uploaded files.

---

## Quick Start (Manual Backup)

### Database Backup

```bash
./scripts/backup.sh
```

This creates `./backups/together_YYYYMMDD_HHMMSS.sql.gz` — a compressed SQL dump of the PostgreSQL database.

**Custom backup directory:**

```bash
./scripts/backup.sh /mnt/backups
```

### File Uploads Backup

```bash
# Create a timestamped backup of uploads
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker run --rm -v together_uploads_data:/data -v "$(pwd)/backups":/backup \
  alpine tar czf "/backup/uploads_${TIMESTAMP}.tar.gz" -C /data .
```

This creates `./backups/uploads_YYYYMMDD_HHMMSS.tar.gz` containing all user-uploaded files.

---

## Automated Backups

### Recommended Strategy: Daily Backups + Weekly Retention

Create a cron job that runs daily:

```bash
# Edit crontab
crontab -e
```

Add this entry (runs daily at 2 AM):

```cron
0 2 * * * cd /path/to/together && ./scripts/backup.sh /mnt/backups && docker run --rm -v together_uploads_data:/data -v /mnt/backups:/backup alpine tar czf "/backup/uploads_$(date +\%Y\%m\%d).tar.gz" -C /data .
```

**Retention policy:** Keep daily backups for 7 days, then archive weekly backups. Example cleanup script:

```bash
#!/usr/bin/env bash
# Keep daily backups for 7 days, then keep one per week for 4 weeks
BACKUP_DIR="/mnt/backups"
find "$BACKUP_DIR" -name "together_*.sql.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +7 -delete
```

### Off-Site Backups (Critical)

Don't keep backups on the same host as your Together instance. If the server fails, you lose everything.

**Option 1: Rclone (Cloud Storage)**

```bash
# Install rclone: https://rclone.org/install/
# Configure rclone to sync to your preferred cloud provider (S3, Backblaze, etc.)
rclone sync /mnt/backups s3:together-backups --delete-after
```

Add to cron after local backups:

```cron
0 2 * * * cd /path/to/together && ./scripts/backup.sh /mnt/backups && docker run --rm -v together_uploads_data:/data -v /mnt/backups:/backup alpine tar czf "/backup/uploads_$(date +\%Y\%m\%d).tar.gz" -C /data . && rclone sync /mnt/backups s3:together-backups --delete-after
```

**Option 2: rsync (Remote Server)**

```bash
rsync -avz --delete /mnt/backups/ user@backup-server:/backups/together/
```

---

## Restore Procedures

### Restoring from Backup

**1. Start only the database container (the app server should not be running during restore):**

```bash
docker compose up -d postgres
```

> **Do not** run `docker compose down` before restoring — that would remove the database container and its network. Instead, stop only the app server if it is running (`docker compose stop server`), or simply ensure only postgres is up.

**2. Restore the database:**

```bash
gunzip < backups/together_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

**3. Restore file uploads:**

```bash
# Remove existing uploads (optional, but recommended to avoid conflicts)
docker run --rm -v together_uploads_data:/data alpine sh -c "rm -rf /data/*"

# Extract backup into uploads volume
docker run --rm -v together_uploads_data:/data -v "$(pwd)/backups":/backup \
  alpine tar xzf "/backup/uploads_YYYYMMDD_HHMMSS.tar.gz" -C /data
```

**4. Restart the services:**

```bash
docker compose up -d
```

**5. Verify the restore:**

```bash
# Check that the database is accessible
docker compose exec server curl -s http://localhost:8080/api/health

# Check logs for any errors
docker compose logs server
```

---

## Combined Backup Script

For convenience, `scripts/backup-full.sh` performs a combined database + file uploads backup in a single command:

```bash
./scripts/backup-full.sh [backup_dir]
```

This script:

- Reads `POSTGRES_USER` and `POSTGRES_DB` from `.env` (or the environment)
- Creates `together_YYYYMMDD_HHMMSS.sql.gz` (database dump) and `uploads_YYYYMMDD_HHMMSS.tar.gz` (file uploads) in the specified backup directory (defaults to `./backups`)
- Uses atomic writes (temp file + rename) so a failed backup never leaves a partial file with the final name
- Cleans up temporary files on exit, even on failure
- Requires services to be running (`docker compose up -d`)

---

## Disaster Recovery Scenarios

### Scenario 1: Server Crash (Hardware Failure)

**Steps:**

1. Provision a new server (or restore from snapshot if using a cloud provider with VM snapshots)
2. Install Docker and Docker Compose
3. Copy the latest backup files to the new server
4. Set up `.env` (same values as the old server)
5. Run restore procedures (see above)
6. Update DNS to point to the new server

**Estimated downtime:** 1–2 hours (mostly provisioning time)

### Scenario 2: Database Corruption

**Symptoms:** Queries fail, strange data, crashes

**Steps:**

1. Stop the services: `docker compose down`
2. Attempt to diagnose the corruption: `docker compose run --rm postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\d"`
3. If corruption is confirmed, restore from the most recent backup
4. Verify data integrity after restore

**Estimated downtime:** 15–30 minutes

### Scenario 3: Accidental Data Deletion

**Symptoms:** A user deleted an important channel, message, or server

**Steps:**

1. Stop the services immediately: `docker compose down` (prevents further changes)
2. Restore from a backup _before_ the deletion occurred
3. Restart services and verify the missing data is restored

**Note:** If you have point-in-time recovery (WAL archiving), you can restore to a specific timestamp without rolling back all data.

**Estimated downtime:** 15–30 minutes

### Scenario 4: Ransomware / Malicious Attack

**Prevention:**

- Use strong, unique `POSTGRES_PASSWORD` and `JWT_SECRET`
- Enable 2FA on all admin accounts (when implemented — see #T020)
- Restrict admin API access to trusted IP addresses
- Keep backups offline or in immutable storage

**Recovery:**

1. Rebuild the server from a clean image
2. Rotate all credentials (`POSTGRES_PASSWORD`, `JWT_SECRET`)
3. Restore from the most recent _verified clean_ backup
4. Review logs to identify how the attack occurred
5. Patch the vulnerability before going back online

**Estimated downtime:** 2–4 hours (security investigation required)

---

## Backup Verification

**Don't assume your backups work.** Test restores regularly.

### Monthly Verification Checklist

```bash
#!/usr/bin/env bash
# Verify that a backup can be restored successfully

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
TEST_DIR="/tmp/together-restore-test"

# Create a test container
docker compose -f docker-compose.yml up -d postgres-test

# Restore the most recent backup to the test container
gunzip < backups/together_$(ls -t backups/*.sql.gz | head -1) | \
  docker compose -f docker-compose.yml exec -T postgres-test \
  psql -U $POSTGRES_USER test_restore_db

# Verify data integrity
docker compose -f docker-compose.yml exec -T postgres-test \
  psql -U $POSTGRES_USER -d test_restore_db -c "SELECT COUNT(*) FROM users;"

# Clean up
docker compose -f docker-compose.yml down -v
```

### Manual Verification Steps

1. **Check backup file size:** Abnormally small files may indicate a failed backup

   ```bash
   du -h backups/*.sql.gz backups/*.tar.gz
   ```

2. **Verify backup integrity:**

   ```bash
   # Test that the gzip file is valid
   gunzip -t backups/together_YYYYMMDD_HHMMSS.sql.gz

   # Test that the tar file is valid
   tar tzf backups/uploads_YYYYMMDD_HHMMSS.tar.gz > /dev/null
   ```

3. **Review backup logs:** Ensure no errors during backup creation

---

## Environment Variables Backup

Critical configuration is stored in `.env`. **Do not commit `.env` to version control.**

### Backup `.env` Securely

```bash
# Encrypt with GPG before storing off-site
gpg --symmetric --cipher-algo AES256 .env --output backups/env_$(date +%Y%m%d).gpg

# Decrypt when restoring
gpg --decrypt backups/env_YYYYMMDD.gpg > .env
```

Store the GPG passphrase in a secure password manager (1Password, Bitwarden, etc.).

### Recommended `.env` Variables to Document

| Variable            | Description            | How to Rotate                                                      |
| ------------------- | ---------------------- | ------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | Database password      | Change in `.env`, then `docker compose up -d postgres`             |
| `JWT_SECRET`        | Session signing secret | Change in `.env` — all sessions will be invalidated                |
| `GIPHY_API_KEY`     | GIF picker integration | Regenerate at [giphy.com/developers](https://developers.giphy.com) |

---

## Performance Considerations

### Backup Duration

| Database Size | Backup Time (gzip) |
| ------------- | ------------------ |
| < 100 MB      | < 10 seconds       |
| 100 MB – 1 GB | 10–60 seconds      |
| 1 GB – 10 GB  | 1–10 minutes       |

For larger databases (> 10 GB), consider:

- **Parallel dumps:** `pg_dump -j 4` (requires PostgreSQL 9.3+)
- **Incremental backups:** Set up WAL archiving for point-in-time recovery
- **Compression trade-offs:** Lower compression = faster backups, larger files

### Backup Storage Requirements

Estimated storage growth for a community with:

- 100 active users
- 10,000 messages per month
- ~50 MB of file uploads per month

| Time Period | Database Size | Uploads Size | Total   |
| ----------- | ------------- | ------------ | ------- |
| 1 day       | ~5 MB         | ~2 MB        | ~7 MB   |
| 1 week      | ~35 MB        | ~14 MB       | ~49 MB  |
| 1 month     | ~150 MB       | ~60 MB       | ~210 MB |

**Storage planning:** Budget 10–20× your current database size for backup retention (7 daily + 4 weekly backups).

---

## Security Best Practices

### 1. Encrypt Backups at Rest

```bash
# Use gpg to encrypt backups before uploading to cloud storage
gpg --encrypt --recipient jordan@example.com backups/together_YYYYMMDD.sql.gz
```

### 2. Use Read-Only Storage for Backups

Store backups on a system that cannot write to your production server (e.g., S3 with write-only access).

### 3. Limit Backup Access

Only trusted administrators should have access to backup files and restore procedures.

### 4. Test Disaster Recovery Annually

Perform a full restore on a test server at least once per year to verify procedures work.

---

## Troubleshooting

### Issue: Backup fails with "connection refused"

**Cause:** PostgreSQL container is not running

**Solution:**

```bash
docker compose ps postgres
docker compose logs postgres
docker compose up -d postgres
```

### Issue: Restore fails with "role does not exist"

**Cause:** `POSTGRES_USER` in the backup doesn't match the current `.env` value

**Solution:** Ensure `.env` matches the backup source, or manually create the role:

```bash
docker compose exec postgres psql -U postgres -c "CREATE ROLE together WITH LOGIN PASSWORD 'password';"
```

### Issue: Missing files after restore

**Cause:** File uploads volume wasn't backed up or restored

**Solution:** Always back up _both_ `postgres_data` and `uploads_data` volumes (see Quick Start above).

### Issue: Backup file is too small (e.g., 1 KB)

**Cause:** Backup failed silently, or database is empty

**Solution:** Verify the backup file is valid (`gunzip -t`) and contains data (`gunzip -c | head -20`).

---

## Additional Resources

- **Self-hosting guide:** `/docs/self-hosting.md` — basic backup/restore reference
- **Architecture docs:** `/docs/architecture.md` — database and storage design
- **Docker volumes:** https://docs.docker.com/storage/volumes/
- **PostgreSQL backups:** https://www.postgresql.org/docs/current/backup.html

---

**Last updated:** 2026-03-12 by @planner (Atlas) 🐘
