-- Event Creation

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
    v_found_count INTEGER;
    v_title TEXT := 'HereNow Database Test Event';
BEGIN

    -- STEP 1: Create a test authentication user
    INSERT INTO auth.users (
        id, aud, role, email,
        encrypted_password, email_confirmed_at,
        created_at, updated_at
    )
    VALUES (
        v_user,
        'authenticated',
        'authenticated',
        v_user || '@test.com',
        '',
        now(),
        now(),
        now()
    );

    -- STEP 2: Create an event
    INSERT INTO public.posts (
        creator_id,
        title,
        description,
        category,
        place_name,
        latitude,
        longitude,
        status,
        published_at,
        expires_at
    )
    VALUES (
        v_user,
        v_title,
        'Testing event creation and database persistence',
        'Social',
        'Test Location',
        41.0,
        -80.0,
        'PUBLISHED',
        now(),
        now() + interval '24 hours'
    )
    RETURNING id INTO v_post;

    INSERT INTO test_results
    VALUES (
        'Event Creation',
        'A new event should be inserted into the posts table',
        'Event created with ID: ' || v_post,
        'PASS'
    );

    -- STEP 3: Verify the event appears in the database
    SELECT COUNT(*)
    INTO v_found_count
    FROM public.posts
    WHERE id = v_post
      AND creator_id = v_user
      AND title = v_title;

    INSERT INTO test_results
    VALUES (
        'Event Retrieval',
        'The created event should be retrievable from the posts table',
        CASE
            WHEN v_found_count = 1
            THEN 'Event successfully retrieved'
            ELSE 'Event was not found'
        END,
        CASE
            WHEN v_found_count = 1 THEN 'PASS'
            ELSE 'FAIL'
        END
    );

    -- STEP 4: Verify event data is correct
    INSERT INTO test_results
    VALUES (
        'Event Data Validation',
        'Event title, location, category, and status should match input',
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM public.posts
                WHERE id = v_post
                  AND title = v_title
                  AND place_name = 'Test Location'
                  AND category = 'Social'
                  AND status = 'PUBLISHED'
            )
            THEN 'All event fields match the input'
            ELSE 'One or more event fields do not match'
        END,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM public.posts
                WHERE id = v_post
                  AND title = v_title
                  AND place_name = 'Test Location'
                  AND category = 'Social'
                  AND status = 'PUBLISHED'
            )
            THEN 'PASS'
            ELSE 'FAIL'
        END
    );

    -- STEP 5: Verify event remains stored
    PERFORM 1
    FROM public.posts
    WHERE id = v_post;

    IF FOUND THEN
        INSERT INTO test_results
        VALUES (
            'Event Persistence',
            'The event should remain stored after the test finishes',
            'Event still exists in the posts table',
            'PASS'
        );
    ELSE
        INSERT INTO test_results
        VALUES (
            'Event Persistence',
            'The event should remain stored after the test finishes',
            'Event no longer exists',
            'FAIL'
        );
    END IF;

    -- IMPORTANT:
    -- Do not delete the test user or event.
    -- Both remain in the database for inspection.

END $$;

-- DISPLAY TEST RESULTS
SELECT
    test_name AS "Test",
    expected_behavior AS "Expected Behavior",
    actual_behavior AS "Actual Behavior",
    test_status AS "Pass/Fail"
FROM test_results
ORDER BY test_name;

-- DISPLAY THE CREATED EVENT
SELECT
    id,
    creator_id,
    title,
    description,
    category,
    place_name,
    latitude,
    longitude,
    status,
    created_at,
    published_at,
    expires_at
FROM public.posts
WHERE title = 'HereNow Database Test Event'
ORDER BY created_at DESC;