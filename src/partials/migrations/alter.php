<?php
/**
 * Migration: {{name}}
 * Generated: {{timestamp}}
 */
use SelfPhp\DB\Serve;

`class {{className}}
{
    /**
     * Run the migration.
     */
    public function up()
    {
        Serve::schema()->table('{{tableName}}', function ($table) {
            // Add your schema changes here
        });

        echo "✅ Migration {{name}} completed\n";
    }

    /**
     * Reverse the migration.
     */
    public function down()
    {
        Serve::schema()->table('{{tableName}}', function ($table) {
            // Reverse your schema changes here
        });

        echo "✅ Migration {{name}} reverted\n";
    }
}`;