# Tests Real - Private Testing Suite

This folder contains real-world integration tests and sensitive testing configurations for the node-red-contrib-kafka project.

## Repository Structure

This project uses a dual-repository setup:

- **Public Repository**: `git@github.com:oriolrius/node-red-contrib-kafka.git` 
  - Contains the main codebase and public documentation
  - Excludes sensitive testing data and real-world configurations

- **Private Repository**: `ssh://git@git.oriolrius.cat:222/oriolrius/node-red-contrib-kafka.git`
  - Contains this `tests-real` folder with sensitive test configurations
  - Includes real Kafka broker configurations, credentials, and integration tests

## Setup Instructions

### Initial Setup with Git Subtree

1. **Clone the main public repository:**
   ```bash
   git clone git@github.com:oriolrius/node-red-contrib-kafka.git
   cd node-red-contrib-kafka
   ```

2. **Add the private repository as a subtree:**
   ```bash
   git subtree add --prefix=tests-real ssh://git@git.oriolrius.cat:222/oriolrius/node-red-contrib-kafka.git main --squash
   ```

3. **Add the private remote for future updates:**
   ```bash
   git remote add private-tests ssh://git@git.oriolrius.cat:222/oriolrius/node-red-contrib-kafka.git
   ```

### Daily Workflow

#### Synchronizing Changes to Public Repository
```bash
# Add and commit all changes (including tests-real)
git add .
git commit -m "Your commit message"

# Push only public code to GitHub (tests-real will be ignored by .gitignore)
git push origin main
```

#### Synchronizing tests-real to Private Repository
```bash
# Push tests-real changes to private repository
git subtree push --prefix=tests-real private-tests main
```

#### Pulling Updates from Private Repository
```bash
# Pull latest changes from private tests repository
git subtree pull --prefix=tests-real private-tests main --squash
```

### Alternative: Manual Sync Script

Create a `sync.sh` script for automated synchronization:

```bash
#!/bin/bash

if [ "$1" = "public" ]; then
    echo "Syncing to public repository..."
    git add .
    git reset tests-real/  # Exclude tests-real from public commits
    git commit -m "$2"
    git push origin main
    
elif [ "$1" = "private" ]; then
    echo "Syncing tests-real to private repository..."
    git subtree push --prefix=tests-real private-tests main
    
elif [ "$1" = "both" ]; then
    echo "Syncing to both repositories..."
    # Sync public first
    git add .
    git commit -m "$2"
    git push origin main
    # Then sync private tests
    git subtree push --prefix=tests-real private-tests main
    
else
    echo "Usage: ./sync.sh [public|private|both] [commit_message]"
fi
```

Usage:
```bash
chmod +x sync.sh
./sync.sh public "Update public documentation"
./sync.sh private
./sync.sh both "Major update with new tests"
```

## .gitignore Configuration

Ensure your main repository's `.gitignore` contains:
```
# Exclude private tests from public repository
tests-real/
```

## Security Notes

- Never commit sensitive data to the public repository
- The private repository should only be accessible to authorized developers
- Always verify which remote you're pushing to before executing git commands
- Consider using SSH keys for secure access to the private repository

## Folder Contents

This `tests-real` folder typically contains:

- Real Kafka broker configurations
- Integration test suites with actual connections
- Performance testing scenarios
- Sensitive environment configurations
- Production-like test data

## Troubleshooting

### If subtree commands fail:
```bash
# Check if the private remote exists
git remote -v

# Re-add the private remote if missing
git remote add private-tests ssh://git@git.oriolrius.cat:222/oriolrius/node-red-contrib-kafka.git
```

### If you accidentally push tests-real to public repo:
1. Remove the sensitive files from the public repository
2. Update `.gitignore` to exclude `tests-real/`
3. Force push to remove from history (if necessary)

### Access denied to private repository:
- Verify SSH key configuration
- Check if the private server is accessible on port 222
- Confirm your user has access to the private repository

## Contributing

When contributing to this private testing suite:

1. Always test changes locally first
2. Document any new test configurations
3. Ensure sensitive data is properly secured
4. Use descriptive commit messages for private repository changes

## Contact

For access to the private repository or questions about the testing setup, contact the repository maintainer.