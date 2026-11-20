const { SupabaseService } = require('../apps/api/dist/common/supabase.service');

// Replaces only Supabase's fluent client; controller, service, and error checking stay real.
module.exports = function fakeSupabase(post, failure = null) {
  const state = { post: { ...post }, writes: [], rpcs: [], tables: [], filters: [], signatures: [], signedPhotos: 0, nearbyRows: [post] };
  const db = { check: SupabaseService.prototype.check, client: {
    from(table) {
      state.tables.push(table);
      let changes;
      const query = {
        select() { return query; },
        eq(column, value) { state.filters.push({ table, column, value }); return query; },
        in() { return query; },
        update(value) { changes = value; return query; },
        single() { return Promise.resolve({ data: { ...state.post }, error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === 'posts' ? { ...state.post } : { id: 'photo-1' }, error: null }); },
        then(resolve, reject) {
          let result;
          if (changes) {
            state.writes.push(changes);
            if (failure === 'update') result = { data: null, error: { message: 'Simulated update failure' } };
            else { Object.assign(state.post, changes); result = { data: null, error: null }; }
          } else if (table === 'profiles') result = { data: [{ id: post.creator_id, display_name: 'Student' }], error: null };
          else if (table === 'media_assets') result = { data: [{ post_id: post.id, object_key: 'student-1/post-1/photo.jpg' }], error: null };
          else throw new Error(`Unexpected query: ${table}`);
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      state.rpcs.push({ name, args });
      if (name === 'nearby_posts_filtered') return { data: state.nearbyRows, error: null };
      if (name !== 'post_interest_summary') throw new Error(`Unexpected RPC: ${name}`);
      if (failure === 'summary') return { data: null, error: { message: 'Simulated summary failure' } };
      return { data: [{ post_id: post.id, interest_count: 2, interested: false }], error: null };
    },
    storage: { from(bucket) { return { async createSignedUrl(objectKey, expires) {
      state.signatures.push({ bucket, objectKey, expires });
      state.signedPhotos++;
      return { data: { signedUrl: 'https://images.example.test/study.jpg' }, error: null };
    } }; } },
  } };
  return { db, state };
};
