-- Assignments accept: ensure pgcrypto digest() resolves on Supabase
-- Date: 2026-03-12
-- Prerequisites:
--  - 2026-02-21_02_assignments_terms_bas_plus.sql

-- Supabase commonly installs extension functions (e.g. digest) in schema "extensions".
-- consume_assignment_token was created with search_path = public, which can hide digest().
-- This migration keeps logic/data intact and only fixes function resolution.

create extension if not exists pgcrypto;

alter function public.consume_assignment_token(text, text, jsonb, inet, text)
  set search_path = public, extensions;

