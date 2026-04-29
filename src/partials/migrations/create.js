/**
 * Migration: Create {{tableName}} table
 * Generated: {{timestamp}}
 */
export async function up(db) {
    // Create table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS {{tableName}} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log(`✅ Created table: {{tableName}}`);
}

export async function down(db) {
    // Drop table
    await db.execute(`DROP TABLE IF EXISTS {{tableName}}`);
    console.log(`✅ Dropped table: {{tableName}}`);
}