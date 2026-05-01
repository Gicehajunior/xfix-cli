<?php
namespace App\Services;

use SelfPhp\DB\Serve;

class MigrationRunner
{
    protected string $migrationsPath;

    public function __construct(string $migrationsPath = 'public/storage/database')
    {
        $this->migrationsPath = rtrim($migrationsPath, '/');
    }

    /**
     * Ensure the migrations tracking table exists.
     */
    public function createMigrationsTable(): void
    {
        // If the table doesn't exist, create it
        if (!Serve::schema()->hasTable('migrations')) {
            Serve::schema()->create('migrations', function ($table) {
                $table->increments('id');
                $table->string('migration', 255)->unique();
                $table->integer('batch');
                $table->timestamp('executed_at')->default(Serve::raw('CURRENT_TIMESTAMP'));
            });
        }
    }

    /**
     * Run all pending migrations.
     *
     * @return array
     */
    public function migrate(): array
    {
        $this->createMigrationsTable();

        // Get all PHP files in the migrations directory
        $files = glob($this->migrationsPath . '/*.php');
        sort($files);

        // Fetch already applied migrations (names without .php)
        $applied = Serve::table('migrations')->pluck('migration')->toArray();
        $appliedMap = array_flip($applied);

        // Determine pending files
        $pending = [];
        foreach ($files as $file) {
            $name = pathinfo($file, PATHINFO_FILENAME);
            if (!isset($appliedMap[$name])) {
                $pending[] = $file;
            }
        }

        if (empty($pending)) {
            return ['success' => true, 'message' => 'Nothing to migrate'];
        }

        // Get the next batch number
        $maxBatch = Serve::table('migrations')->max('batch');
        $batch = ($maxBatch ?? 0) + 1;

        $migrated = [];
        foreach ($pending as $file) {
            $name = pathinfo($file, PATHINFO_FILENAME);
            require_once $file;
            $className = $this->guessClassName($name);

            if (!class_exists($className)) {
                throw new \Exception("Migration class $className not found in $file");
            }

            $instance = new $className();
            $instance->up(); // The migration uses Serve internally

            // Record the migration
            Serve::table('migrations')->insert([
                'migration' => $name,
                'batch' => $batch,
                'executed_at' => date('Y-m-d H:i:s')
            ]);

            $migrated[] = $name;
        }

        return [
            'success' => true,
            'message' => 'Migrations complete',
            'migrated' => $migrated,
            'batch' => $batch
        ];
    }

    /**
     * Convert filename to class name.
     * e.g., "20260429104650_create_users_table" → "CreateUsersTable"
     */
    private function guessClassName(string $filename): string
    {
        $parts = explode('_', $filename, 2);
        $name = end($parts);
        // snake_case to PascalCase
        return str_replace('_', '', ucwords($name, '_'));
    }
}