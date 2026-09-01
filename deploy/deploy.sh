#!/bin/bash
# SEP MVP V2.0 - Production Deployment Script
# Supports: AWS, Google Cloud, Azure, Self-Hosted

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
WEB_DIR="$PROJECT_ROOT/frontend/web"
MOBILE_DIR="$PROJECT_ROOT/frontend/mobile"

# Defaults
ENVIRONMENT="development"
PLATFORM="self-hosted"
REGISTRY=""
DOCKER_IMAGE_TAG="latest"

# Functions
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

OPTIONS:
    -e, --environment ENV       Environment: development, staging, production
    -p, --platform PLATFORM     Platform: aws, gcp, azure, self-hosted
    -r, --registry REGISTRY     Docker registry (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com)
    -t, --tag TAG               Docker image tag (default: latest)
    -h, --help                  Show this help message

EXAMPLES:
    # Deploy to AWS
    $0 -e production -p aws -r 123456789.dkr.ecr.us-east-1.amazonaws.com

    # Deploy to Google Cloud
    $0 -e production -p gcp -r gcr.io/your-project-id

    # Deploy to Azure
    $0 -e production -p azure -r yourregistry.azurecr.io

    # Self-hosted deployment
    $0 -e production -p self-hosted

EOF
    exit 1
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -p|--platform)
                PLATFORM="$2"
                shift 2
                ;;
            -r|--registry)
                REGISTRY="$2"
                shift 2
                ;;
            -t|--tag)
                DOCKER_IMAGE_TAG="$2"
                shift 2
                ;;
            -h|--help)
                show_usage
                ;;
            *)
                echo "Unknown option: $1"
                show_usage
                ;;
        esac
    done
}

check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker not found. Please install Docker first."
        exit 1
    fi
    print_success "Docker installed: $(docker --version)"

    # Check Docker Compose
    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        print_error "Docker Compose not found. Please install Docker Compose first."
        exit 1
    fi
    print_success "Docker Compose installed: $(docker compose version | head -1)"

    # Check environment file
    if [ ! -f ".env.$ENVIRONMENT" ]; then
        print_warning "Environment file .env.$ENVIRONMENT not found"
        print_warning "Using .env.production.example as template"
        if [ ! -f ".env.production.example" ]; then
            print_error "Template file .env.production.example not found"
            exit 1
        fi
        cp .env.production.example .env.$ENVIRONMENT
        print_warning "Created .env.$ENVIRONMENT - PLEASE EDIT WITH YOUR VALUES"
    fi
    print_success "Environment file found: .env.$ENVIRONMENT"
}

build_docker_image() {
    print_header "Building Docker Image"

    local IMAGE_NAME="sep-backend"
    local FULL_IMAGE_NAME="$IMAGE_NAME:$DOCKER_IMAGE_TAG"

    if [ -n "$REGISTRY" ]; then
        FULL_IMAGE_NAME="$REGISTRY/$FULL_IMAGE_NAME"
    fi

    print_warning "Building Docker image: $FULL_IMAGE_NAME"

    docker build \
        -f "$SCRIPT_DIR/Dockerfile.backend" \
        -t "$FULL_IMAGE_NAME" \
        "$PROJECT_ROOT"

    if [ $? -eq 0 ]; then
        print_success "Docker image built successfully"
        echo "Image: $FULL_IMAGE_NAME"
    else
        print_error "Failed to build Docker image"
        exit 1
    fi
}

push_to_registry() {
    if [ -z "$REGISTRY" ]; then
        print_warning "No registry specified, skipping push"
        return
    fi

    print_header "Pushing Docker Image to Registry"

    local IMAGE_NAME="$REGISTRY/sep-backend:$DOCKER_IMAGE_TAG"

    print_warning "Pushing $IMAGE_NAME to registry"
    docker push "$IMAGE_NAME"

    if [ $? -eq 0 ]; then
        print_success "Image pushed to registry successfully"
    else
        print_error "Failed to push image to registry"
        exit 1
    fi
}

test_local_deployment() {
    print_header "Testing Local Docker Compose Deployment"

    # Check if services are already running
    if docker compose ps | grep -q "sep-v2-backend"; then
        print_warning "Services already running, testing existing deployment"
    else
        print_warning "Starting services..."
        docker compose up -d
        sleep 10
    fi

    # Test health endpoint
    print_warning "Testing API health endpoint..."
    HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health)

    if [ "$HEALTH" = "200" ]; then
        print_success "Health check passed (HTTP $HEALTH)"
    else
        print_error "Health check failed (HTTP $HEALTH)"
        docker compose logs backend
        exit 1
    fi

    # Test authentication
    print_warning "Testing authentication..."
    AUTH_RESPONSE=$(curl -s -X POST http://localhost:3001/api/v2/auth/login \
        -H "Content-Type: application/json" \
        -d '{"email":"kim@company.com","password":"password123"}')

    if echo "$AUTH_RESPONSE" | grep -q "accessToken"; then
        print_success "Authentication test passed"
    else
        print_error "Authentication test failed"
        echo "$AUTH_RESPONSE" | jq .
        exit 1
    fi

    print_success "All local tests passed"
}

deploy_aws() {
    print_header "AWS Deployment Instructions"

    cat << 'EOF'
AWS Deployment Guide (ECS + RDS + ElastiCache + CloudFront)

STEP 1: Prepare AWS Environment
    1. Create AWS account if not already done
    2. Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
    3. Configure credentials: aws configure

STEP 2: Create ECR Repository
    aws ecr create-repository --repository-name sep-backend --region us-east-1

STEP 3: Push Docker Image
    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
    docker tag sep-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sep-backend:latest
    docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sep-backend:latest

STEP 4: Create RDS PostgreSQL Instance
    aws rds create-db-instance \
        --db-instance-identifier sep-v2-postgres \
        --db-instance-class db.t3.micro \
        --engine postgres \
        --engine-version 15.3 \
        --master-username postgres \
        --master-user-password YOUR_SECURE_PASSWORD \
        --allocated-storage 20 \
        --storage-type gp3 \
        --publicly-accessible false \
        --region us-east-1

STEP 5: Create ECS Task Definition
    aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json

STEP 6: Create ECS Service
    aws ecs create-service \
        --cluster sep-v2-cluster \
        --service-name sep-backend \
        --task-definition sep-backend:1 \
        --desired-count 1 \
        --launch-type EC2

STEP 7: Deploy Frontend to CloudFront + S3
    # Build web frontend
    cd ../frontend/web
    npm run build

    # Create S3 bucket
    aws s3 mb s3://sep-v2-frontend --region us-east-1

    # Upload files
    aws s3 sync dist/ s3://sep-v2-frontend/ --delete

    # Create CloudFront distribution (via AWS Console or terraform)

STEP 8: Configure SSL Certificate
    # Use AWS Certificate Manager (ACM)
    aws acm request-certificate \
        --domain-name yourdomain.com \
        --subject-alternative-names "*.yourdomain.com"

STEP 9: Monitoring Setup
    # Enable CloudWatch monitoring
    # Create CloudWatch alarms for API errors, latency, etc.
    # Set up Sentry for error tracking
    # Configure DataDog or New Relic for APM

For detailed AWS CloudFormation template, see: deploy/cloudformation-template.yml

EOF
}

deploy_gcp() {
    print_header "Google Cloud Deployment Instructions"

    cat << 'EOF'
Google Cloud Deployment Guide (Cloud Run + Cloud SQL + Memorystore)

STEP 1: Setup Google Cloud Project
    1. Create GCP account if not already done
    2. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
    3. Initialize: gcloud init

STEP 2: Enable Required APIs
    gcloud services enable run.googleapis.com sql-component.googleapis.com redis.googleapis.com container.googleapis.com

STEP 3: Create Cloud SQL PostgreSQL Instance
    gcloud sql instances create sep-v2-postgres \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=us-central1 \
        --availability-type=regional

STEP 4: Create Database
    gcloud sql databases create sep_v2 --instance=sep-v2-postgres

STEP 5: Push Docker Image to Artifact Registry
    # Enable Artifact Registry
    gcloud services enable artifactregistry.googleapis.com

    # Create repository
    gcloud artifacts repositories create sep-v2 \
        --repository-format=docker \
        --location=us-central1

    # Build and push
    gcloud builds submit \
        --region=us-central1 \
        --tag=us-central1-docker.pkg.dev/YOUR_PROJECT/sep-v2/sep-backend:latest

STEP 6: Deploy to Cloud Run
    gcloud run deploy sep-backend \
        --image=us-central1-docker.pkg.dev/YOUR_PROJECT/sep-v2/sep-backend:latest \
        --platform=managed \
        --region=us-central1 \
        --memory=1Gi \
        --cpu=1 \
        --set-env-vars="DB_HOST=10.x.x.x,DB_PORT=5432,JWT_SECRET=YOUR_SECRET"

STEP 7: Deploy Web Frontend to Cloud Storage
    # Build frontend
    cd ../frontend/web
    npm run build

    # Create bucket
    gsutil mb gs://sep-v2-frontend

    # Upload files
    gsutil -m cp -r dist/* gs://sep-v2-frontend/

    # Create Load Balancer pointing to bucket

STEP 8: Setup Custom Domain
    gcloud domains registrations update yourdomain.com --dns-settings=ns-update

STEP 9: Monitoring Setup
    # Enable Cloud Monitoring
    # Create alert policies
    # Setup Error Reporting
    # Configure Cloud Logging

For detailed Terraform configuration, see: deploy/terraform-gcp/

EOF
}

deploy_azure() {
    print_header "Azure Deployment Instructions"

    cat << 'EOF'
Microsoft Azure Deployment Guide (Container Instances + Database + Cache)

STEP 1: Setup Azure Account
    1. Create Azure account if not already done
    2. Install Azure CLI: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
    3. Login: az login

STEP 2: Create Resource Group
    az group create --name sep-v2-rg --location eastus

STEP 3: Create Azure Container Registry
    az acr create --resource-group sep-v2-rg \
        --name sepv2registry \
        --sku Basic

STEP 4: Push Docker Image
    az acr build --registry sepv2registry --image sep-backend:latest .

STEP 5: Create PostgreSQL Server
    az postgres server create \
        --resource-group sep-v2-rg \
        --name sep-v2-postgres \
        --location eastus \
        --admin-user postgres \
        --admin-password YOUR_PASSWORD \
        --sku-name B_Gen5_1 \
        --storage-size 51200

STEP 6: Create Redis Cache
    az redis create \
        --resource-group sep-v2-rg \
        --name sep-v2-redis \
        --location eastus \
        --sku Basic \
        --vm-size c0

STEP 7: Deploy Backend to Container Instances
    az container create \
        --resource-group sep-v2-rg \
        --name sep-backend \
        --image sepv2registry.azurecr.io/sep-backend:latest \
        --cpu 1 \
        --memory 1 \
        --ports 3000 \
        --environment-variables DB_HOST=sep-v2-postgres.postgres.database.azure.com

STEP 8: Deploy Web Frontend to App Service
    # Create App Service Plan
    az appservice plan create \
        --name sep-v2-plan \
        --resource-group sep-v2-rg \
        --sku B1 \
        --is-linux

    # Create Web App
    az webapp create \
        --resource-group sep-v2-rg \
        --plan sep-v2-plan \
        --name sep-v2-web

STEP 9: Setup Custom Domain
    az webapp config hostname add \
        --resource-group sep-v2-rg \
        --webapp-name sep-v2-web \
        --hostname yourdomain.com

STEP 10: Monitoring Setup
    # Enable Application Insights
    # Configure Alert Rules
    # Setup Log Analytics

For detailed Azure Resource Manager template, see: deploy/azure-template.json

EOF
}

deploy_self_hosted() {
    print_header "Self-Hosted Deployment Instructions"

    cat << 'EOF'
Self-Hosted Deployment Guide (Docker Compose on Linux Server)

STEP 1: Provision Linux Server
    - Recommended: Ubuntu 22.04 LTS
    - Minimum 2GB RAM, 2 vCPU
    - 20GB disk space

    AWS EC2: t3.small instance
    DigitalOcean: Basic Droplet ($6/month)
    Linode: Shared CPU Instance

STEP 2: Install Docker and Docker Compose
    # Update system
    sudo apt update && sudo apt upgrade -y

    # Install Docker
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh

    # Install Docker Compose
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose

    # Add user to docker group
    sudo usermod -aG docker $USER
    newgrp docker

STEP 3: Clone Repository
    git clone https://github.com/MacTechIN/SEP-V2.0.git
    cd SEP-V2.0

STEP 4: Configure Environment
    cp .env.production.example .env.production
    # Edit .env.production with your values
    nano .env.production

STEP 5: Install SSL Certificate
    # Using Let's Encrypt (free)
    sudo apt install certbot python3-certbot-nginx -y
    sudo certbot certonly --standalone -d yourdomain.com

    # Certificate files will be in:
    # /etc/letsencrypt/live/yourdomain.com/

STEP 6: Configure Nginx Reverse Proxy
    # Create Nginx config
    sudo tee /etc/nginx/sites-available/sep-v2 > /dev/null <<EOF
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

    # Enable site
    sudo ln -s /etc/nginx/sites-available/sep-v2 /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx

STEP 7: Start Services
    cd deploy/
    docker compose up -d

STEP 8: Verify Deployment
    # Check services
    docker compose ps

    # Test health
    curl https://yourdomain.com/health

    # Check logs
    docker compose logs -f backend

STEP 9: Setup Auto-Renewal for SSL
    sudo systemctl enable certbot.timer
    sudo systemctl start certbot.timer

STEP 10: Setup Backups
    # Daily PostgreSQL backup
    sudo crontab -e

    # Add line:
    0 2 * * * docker exec sep-v2-postgres pg_dump -U postgres sep_v2_dev | gzip > /backups/sep-db-$(date +\%Y\%m\%d).sql.gz

STEP 11: Monitoring
    # Install Uptime Kuma for monitoring
    docker run -d -p 3002:3000 --name uptime-kuma louislam/uptime-kuma:1

    # Access at http://localhost:3002

Estimated monthly cost: $10-30 (depending on server choice)

EOF
}

deploy_production() {
    print_header "Production Deployment"

    print_warning "BEFORE DEPLOYING TO PRODUCTION:"
    print_warning "1. Change JWT_SECRET to a secure random value"
    print_warning "2. Set secure DATABASE password"
    print_warning "3. Configure HTTPS/SSL certificate"
    print_warning "4. Set up monitoring and alerting"
    print_warning "5. Configure automated backups"
    print_warning "6. Review security checklist in PRODUCTION_CHECKLIST.md"

    read -p "Have you completed all production checklist items? (yes/no): " PROD_READY

    if [ "$PROD_READY" != "yes" ]; then
        print_error "Production deployment cancelled"
        exit 1
    fi

    case $PLATFORM in
        aws)
            deploy_aws
            ;;
        gcp)
            deploy_gcp
            ;;
        azure)
            deploy_azure
            ;;
        self-hosted)
            deploy_self_hosted
            ;;
        *)
            print_error "Unknown platform: $PLATFORM"
            exit 1
            ;;
    esac
}

main() {
    parse_args "$@"

    print_header "SEP MVP V2.0 - Production Deployment"
    echo "Environment: $ENVIRONMENT"
    echo "Platform: $PLATFORM"
    echo "Docker Tag: $DOCKER_IMAGE_TAG"
    echo ""

    check_prerequisites
    build_docker_image

    if [ "$PLATFORM" != "self-hosted" ]; then
        push_to_registry
    fi

    test_local_deployment
    deploy_production

    print_header "Deployment Complete"
    print_success "Follow the platform-specific instructions above to complete deployment"
}

main "$@"
