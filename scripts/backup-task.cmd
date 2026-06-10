@echo off
rem Weekly Convex snapshot backup (Sundays 21:00) — Windows Task Scheduler.
rem Weekly, not nightly: each backup reads the full DB against the free
rem tier's 1 GB/month database-bandwidth quota.
cd /d C:\Users\comer\Desktop\works\Intentory-System
call pnpm backup
