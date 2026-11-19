-- Invalid Latitude and Empty Comment

CREATE TEMP TABLE test_results (
    test_name TEXT,
    expected_behavior TEXT,
    actual_behavior TEXT,
    test_status TEXT
);

DO $$
DECLARE
    v_user UUID := gen_random_uuid();
    v_post UUID;
BEGIN

    -- Create test authentication user
    INSERT INTO auth.users (
        id, aud, role, email,
        encrypted_password, email_confirmed_at,
        created_at, updated_at
    )
    VALUES (
        v_user, 'authenticated', 'authenticated',
        v_user || '@test.com', '', now(), now(), now()
    );

    -- Create valid post for comment testing
    INSERT INTO public.posts (
        creator_id, title, place_name,
        latitude, longitude, status
    )
    VALUES (
        v_user, 'Test Activity', 'Test Location',
        41.0, -80.0, 'PUBLISHED'
    )
    RETURNING id INTO v_post;

    -- TEST 1: Verify invalid latitude is rejected
    BEGIN
        INSERT INTO public.posts (
            creator_id, place_name, latitude, longitude
        )
        VALUES (
            v_user, 'Invalid Location', 100, -80
        );

        INSERT INTO test_results
        VALUES (
            'Invalid Latitude',
            'Latitude outside -90 to 90 should be rejected',
            'Invalid latitude was accepted',
            'FAIL'
        );

    EXCEPTION WHEN check_violation THEN
        INSERT INTO test_results
        VALUES (
            'Invalid Latitude',
            'Latitude outside -90 to 90 should be rejected',
            'Database rejected invalid latitude',
            'PASS'
        );
    END;

    -- TEST 2: Verify empty comment is rejected
    BEGIN
        INSERT INTO public.comments (
            post_id, author_id, body
        )
        VALUES (
            v_post, v_user, '   '
        );

        INSERT INTO test_results
        VALUES (
            'Empty Comment',
            'Empty or whitespace-only comments should be rejected',
            'Empty comment was accepted',
            'FAIL'
        );

    EXCEPTION WHEN check_violation THEN
        INSERT INTO test_results
        VALUES (
            'Empty Comment',
            'Empty or whitespace-only comments should be rejected',
            'Database rejected empty comment',
            'PASS'
        );
    END;

    -- Clean up test user and dependent records
    DELETE FROM auth.users WHERE id = v_user;

EXCEPTION WHEN OTHERS THEN
    DELETE FROM auth.users WHERE id = v_user;
    RAISE;
END $$;

-- DISPLAY TEST RESULTS
SELECT
    test_name AS "Test",
    expected_behavior AS "Expected Behavior",
    actual_behavior AS "Actual Behavior",
    test_status AS "Pass/Fail"
FROM test_results
ORDER BY test_name;