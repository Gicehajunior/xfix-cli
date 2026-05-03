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
        // Write your migration logic here
        echo "✅ Migration {{name}} completed\n";
    }

    /**
     * Reverse the migration.
     */
    public function down()
    {
        // Write your rollback logic here
        echo "✅ Migration {{name}} reverted\n";
    }
}`;