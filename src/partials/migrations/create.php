<?php
/**
 * Migration: Create {{tableName}} table
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
        Serve::schema()->create('{{tableName}}', function ($table) {
            $table->increments('id');
            $table->timestamp('created_at')->default(Serve::raw('CURRENT_TIMESTAMP'));
            $table->timestamp('updated_at')->default(Serve::raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
        });

        echo "✅ Created table: {{tableName}}\n";
    }

    /**
     * Reverse the migration.
     */
    public function down()
    {
        Serve::schema()->dropIfExists('{{tableName}}');
        echo "✅ Dropped table: {{tableName}}\n";
    }
}`;