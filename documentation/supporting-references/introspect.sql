\pset format unaligned
\pset tuples_only on
SELECT json_build_object(
 'tables', (SELECT json_agg(t ORDER BY t->>'name') FROM (
   SELECT json_build_object('name', c.relname, 'rls', c.relrowsecurity,
     'comment', obj_description(c.oid),
     'columns', (SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
     'constraints', (SELECT json_agg(json_build_object('name',co.conname,'type',co.contype,'def',pg_get_constraintdef(co.oid)) ORDER BY co.contype, co.conname) FROM pg_constraint co WHERE co.conrelid=c.oid),
     'indexes', (SELECT json_agg(json_build_object('name',i.relname,'def',pg_get_indexdef(i.oid)) ORDER BY i.relname) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=c.oid AND NOT x.indisprimary),
     'triggers', (SELECT json_agg(json_build_object('name',tg.tgname,'def',pg_get_triggerdef(tg.oid)) ORDER BY tg.tgname) FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND NOT tg.tgisinternal),
     'policies', (SELECT json_agg(json_build_object('name',p.polname,'cmd',p.polcmd,'roles',(SELECT array_agg(rolname) FROM pg_roles WHERE oid = ANY(p.polroles)),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid)
   ) t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) s),
 'views', (SELECT json_agg(json_build_object('name',c.relname,'kind',c.relkind) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')),
 'enums', (SELECT json_agg(json_build_object('name',t.typname,'values',(SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid=t.oid)) ORDER BY t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'),
 'functions', (SELECT json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),'secdef',p.prosecdef,'lang',l.lanname,'comment',obj_description(p.oid),
     'grants',(SELECT array_agg(DISTINCT r.rolname) FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE a.privilege_type='EXECUTE'),
     'public_exec', EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE a.grantee=0), 'extension', EXISTS(SELECT 1 FROM pg_depend dp WHERE dp.classid='pg_proc'::regclass AND dp.objid=p.oid AND dp.deptype='e')) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.prokind='f'),
 'cron', (SELECT json_agg(json_build_object('name',jobname,'schedule',schedule,'command',command) ORDER BY jobname) FROM cron.job),
 'buckets', (SELECT json_agg(json_build_object('id',id,'public',public,'limit',file_size_limit,'mime',allowed_mime_types) ORDER BY id) FROM storage.buckets),
 'storage_policies', (SELECT json_agg(policyname ORDER BY policyname) FROM pg_policies WHERE schemaname='storage'),
 'publication', (SELECT json_agg(tablename ORDER BY tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime'),
 'extensions', (SELECT json_agg(extname ORDER BY extname) FROM pg_extension)
);
