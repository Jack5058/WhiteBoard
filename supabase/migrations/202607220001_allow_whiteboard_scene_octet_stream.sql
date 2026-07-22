update storage.buckets
set allowed_mime_types = array['application/json', 'application/octet-stream']::text[]
where id = 'whiteboard-scenes';

notify pgrst, 'reload schema';
