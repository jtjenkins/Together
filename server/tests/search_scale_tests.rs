//! Scale tests for message search.
//!
//! These tests verify search performance at scale (up to 1M messages).
//! Run with: cargo test --test search_scale_tests -- --ignored --nocapture
//!
//! Prerequisites:
//! - PostgreSQL database with the Together schema
//! - DATABASE_URL environment variable set
//!
//! The tests are marked #[ignore] because they:
//! - Take several minutes to run
//! - Require a database connection
//! - Insert a large volume of test data

use std::time::Instant;
use uuid::Uuid;

// ============================================================================
// Test data generation
// ============================================================================

/// Generate realistic-ish message content for testing.
fn generate_message_content(seed: usize) -> String {
    let words = [
        "hello",
        "world",
        "test",
        "message",
        "search",
        "query",
        "database",
        "server",
        "channel",
        "user",
        "text",
        "content",
        "index",
        "full",
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "must",
        "shall",
        "can",
        "need",
        "dare",
        "awesome",
        "great",
        "cool",
        "nice",
        "amazing",
        "wonderful",
        "fantastic",
        "discussion",
        "meeting",
        "project",
        "team",
        "work",
        "code",
        "feature",
        "bug",
        "fix",
        "release",
        "deploy",
        "production",
        "staging",
        "development",
    ];

    let mut content = String::new();
    let word_count = 5 + seed % 20; // 5-24 words per message

    for i in 0..word_count {
        if i > 0 {
            content.push(' ');
        }
        content.push_str(words[(seed + i) % words.len()]);
    }

    // Add some unique identifier every 100 messages for rare term testing
    if seed.is_multiple_of(100) {
        content.push_str(&format!(" uniqueterm{}", seed / 100));
    }

    // Add a common term to ~10% of messages
    if seed.is_multiple_of(10) {
        content.push_str(" commonterm");
    }

    content
}

// ============================================================================
// Scale tests
// ============================================================================

/// Test search scalability with 100K messages.
///
/// This is a smaller-scale test suitable for CI. For full 1M testing,
/// use the ignored test below.
#[sqlx::test]
async fn test_search_scales_to_100k_messages(pool: sqlx::PgPool) -> sqlx::Result<()> {
    // Setup: Create server, channel, and users
    let server_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, status) VALUES ($1, $2, $3, 'online')",
    )
    .bind(user_id)
    .bind(format!("testuser_{}", &user_id.simple().to_string()[..8]))
    .bind("$2b$12$testhash")
    .execute(&pool)
    .await?;

    sqlx::query("INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3)")
        .bind(server_id)
        .bind(format!(
            "test-server-{}",
            &server_id.simple().to_string()[..8]
        ))
        .bind(user_id)
        .execute(&pool)
        .await?;

    sqlx::query("INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, $3, 'text')")
        .bind(channel_id)
        .bind(server_id)
        .bind("general")
        .execute(&pool)
        .await?;

    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)")
        .bind(user_id)
        .bind(server_id)
        .execute(&pool)
        .await?;

    // Insert 100K messages in batches
    let batch_size = 10_000;
    let total_messages = 100_000;

    println!("Inserting {} messages...", total_messages);
    let insert_start = Instant::now();

    for batch in 0..(total_messages / batch_size) {
        let mut query_builder = sqlx::query_builder::QueryBuilder::new(
            "INSERT INTO messages (id, channel_id, author_id, content) ",
        );
        query_builder.push_values(0..batch_size, |mut b, i| {
            let msg_num = batch * batch_size + i;
            b.push_bind(Uuid::new_v4())
                .push_bind(channel_id)
                .push_bind(user_id)
                .push_bind(generate_message_content(msg_num));
        });
        query_builder.build().execute(&pool).await?;

        if batch % 10 == 0 {
            println!("  Inserted {} messages...", (batch + 1) * batch_size);
        }
    }

    println!("Insertion took {:?}", insert_start.elapsed());

    // Run the analyze to update statistics
    sqlx::query("ANALYZE messages").execute(&pool).await?;

    // Test 1: Search for a rare term (GIN index should make this fast even on CI)
    println!("Test 1: Rare term search...");
    let rare_term = "uniqueterm500"; // Appears in ~1 message
    let start = Instant::now();
    let result = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM messages WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)"
    )
    .bind(rare_term)
    .fetch_one(&pool)
    .await?;
    let rare_duration = start.elapsed();
    println!("  Found {} results in {:?}", result, rare_duration);
    assert!(
        rare_duration.as_millis() < 5000,
        "Rare term search took {:?}",
        rare_duration
    );

    // Test 2: Search for a common term (should still be reasonable on CI)
    println!("Test 2: Common term search...");
    let common_term = "commonterm"; // Appears in ~10K messages
    let start = Instant::now();
    let result = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM messages WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)"
    )
    .bind(common_term)
    .fetch_one(&pool)
    .await?;
    let common_duration = start.elapsed();
    println!("  Found {} results in {:?}", result, common_duration);
    assert!(
        common_duration.as_millis() < 10000,
        "Common term search took {:?}",
        common_duration
    );

    // Test 3: Paginated search (first page)
    println!("Test 3: Paginated search (first 50 results)...");
    let start = Instant::now();
    let results: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, content FROM messages 
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC, created_at DESC
         LIMIT 50"
    )
    .bind(common_term)
    .fetch_all(&pool)
    .await?;
    let page_duration = start.elapsed();
    println!(
        "  Retrieved {} results in {:?}",
        results.len(),
        page_duration
    );
    assert!(
        page_duration.as_millis() < 5000,
        "Paginated search took {:?}",
        page_duration
    );

    // Test 4: Full text search with ranking
    println!("Test 4: Ranked search...");
    let search_query = "hello world"; // Common phrase
    let start = Instant::now();
    let results: Vec<(Uuid, String, f32)> = sqlx::query_as(
        "SELECT id, content, ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank 
         FROM messages 
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC, created_at DESC
         LIMIT 50"
    )
    .bind(search_query)
    .fetch_all(&pool)
    .await?;
    let ranked_duration = start.elapsed();
    println!(
        "  Retrieved {} ranked results in {:?}",
        results.len(),
        ranked_duration
    );
    assert!(
        ranked_duration.as_millis() < 5000,
        "Ranked search took {:?}",
        ranked_duration
    );

    // Cleanup
    sqlx::query("DELETE FROM messages WHERE channel_id = $1")
        .bind(channel_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM server_members WHERE server_id = $1")
        .bind(server_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM channels WHERE server_id = $1")
        .bind(server_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;

    println!("Scale test completed successfully!");
    Ok(())
}

/// Test search scalability with 1M messages.
///
/// Run with: cargo test --test search_scale_tests -- --ignored scale_1m --nocapture
#[sqlx::test]
#[ignore] // Takes ~5 minutes to run, disabled by default
async fn test_search_scales_to_1m_messages(pool: sqlx::PgPool) -> sqlx::Result<()> {
    // Setup: Same as 100K test
    let server_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, status) VALUES ($1, $2, $3, 'online')",
    )
    .bind(user_id)
    .bind(format!("testuser_{}", &user_id.simple().to_string()[..8]))
    .bind("$2b$12$testhash")
    .execute(&pool)
    .await?;

    sqlx::query("INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3)")
        .bind(server_id)
        .bind(format!(
            "test-server-{}",
            &server_id.simple().to_string()[..8]
        ))
        .bind(user_id)
        .execute(&pool)
        .await?;

    sqlx::query("INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, $3, 'text')")
        .bind(channel_id)
        .bind(server_id)
        .bind("general")
        .execute(&pool)
        .await?;

    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)")
        .bind(user_id)
        .bind(server_id)
        .execute(&pool)
        .await?;

    // Insert 1M messages in batches of 10K
    let batch_size = 10_000;
    let total_messages = 1_000_000;

    println!("=== 1M Message Scale Test ===");
    println!("Inserting {} messages...", total_messages);
    let insert_start = Instant::now();

    for batch in 0..(total_messages / batch_size) {
        let mut query_builder = sqlx::query_builder::QueryBuilder::new(
            "INSERT INTO messages (id, channel_id, author_id, content) ",
        );
        query_builder.push_values(0..batch_size, |mut b, i| {
            let msg_num = batch * batch_size + i;
            b.push_bind(Uuid::new_v4())
                .push_bind(channel_id)
                .push_bind(user_id)
                .push_bind(generate_message_content(msg_num));
        });
        query_builder.build().execute(&pool).await?;

        if batch % 20 == 0 {
            println!("  Inserted {} messages...", (batch + 1) * batch_size);
        }
    }

    println!("Insertion took {:?}", insert_start.elapsed());

    // Analyze tables
    println!("Analyzing tables...");
    sqlx::query("ANALYZE messages").execute(&pool).await?;

    // Performance tests
    println!("\n=== Performance Tests ===\n");

    // Test 1: Rare term (<10 matches)
    println!("Test 1: Rare term (uniqueterm999)");
    let start = Instant::now();
    let result = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM messages WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)"
    )
    .bind("uniqueterm999")
    .fetch_one(&pool)
    .await?;
    let duration = start.elapsed();
    println!("  Count: {}, Duration: {:?}", result, duration);
    assert!(
        duration.as_millis() < 100,
        "Rare term too slow: {:?}",
        duration
    );

    // Test 2: Medium frequency (~10K matches)
    println!("\nTest 2: Medium frequency (commonterm)");
    let start = Instant::now();
    let result = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM messages WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)"
    )
    .bind("commonterm")
    .fetch_one(&pool)
    .await?;
    let duration = start.elapsed();
    println!("  Count: {}, Duration: {:?}", result, duration);
    assert!(
        duration.as_millis() < 500,
        "Medium term too slow: {:?}",
        duration
    );

    // Test 3: First page with ranking
    println!("\nTest 3: First 100 results with ranking");
    let start = Instant::now();
    let results: Vec<(Uuid, String, f32)> = sqlx::query_as(
        "SELECT id, content, ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank 
         FROM messages 
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC, created_at DESC
         LIMIT 100"
    )
    .bind("hello world test")
    .fetch_all(&pool)
    .await?;
    let duration = start.elapsed();
    println!("  Results: {}, Duration: {:?}", results.len(), duration);
    assert!(
        duration.as_millis() < 200,
        "Ranked first page too slow: {:?}",
        duration
    );

    // Test 4: Highlight
    println!("\nTest 4: Search with highlighting");
    let start = Instant::now();
    let results: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, ts_headline('english', content, plainto_tsquery('english', $1),
            'StartSel=<mark> StopSel=</mark> MaxWords=35 MinWords=15') as highlight
         FROM messages 
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
         LIMIT 50",
    )
    .bind("project")
    .fetch_all(&pool)
    .await?;
    let duration = start.elapsed();
    println!("  Results: {}, Duration: {:?}", results.len(), duration);
    assert!(
        duration.as_millis() < 200,
        "Highlight search too slow: {:?}",
        duration
    );

    // Test 5: Phrase search
    println!("\nTest 5: Phrase search");
    let start = Instant::now();
    let result = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM messages WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)"
    )
    .bind("awesome feature")
    .fetch_one(&pool)
    .await?;
    let duration = start.elapsed();
    println!("  Count: {}, Duration: {:?}", result, duration);
    assert!(
        duration.as_millis() < 100,
        "Phrase search too slow: {:?}",
        duration
    );

    println!("\n=== All scale tests passed! ===");
    println!("1M messages indexed and searchable with <200ms latency.");

    // Cleanup
    println!("\nCleaning up...");
    sqlx::query("DELETE FROM messages WHERE channel_id = $1")
        .bind(channel_id)
        .execute(&pool)
        .await?;
    println!("  Done!");

    Ok(())
}
