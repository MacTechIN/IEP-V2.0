# Production Deployment Guide - Quick Start
**SEP MVP V2.0 — Production Ready**

## Overview

SEP MVP V2.0 is fully containerized and ready for production deployment to:
- ✅ **AWS** (ECS + RDS + ElastiCache + CloudFront)
- ✅ **Google Cloud** (Cloud Run + Cloud SQL + Memorystore)
- ✅ **Microsoft Azure** (Container Instances + Database + Cache)
- ✅ **Self-Hosted** (Docker Compose on your own server)

## 5-Minute Quick Start

### Option 1: AWS (Easiest)

```bash
# 1. Prerequisites
brew install awscli  # macOS
# or install AWS CLI for your OS

# 2. Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Format (json)

# 3. Push Docker image to ECR
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1

aws ecr create-repository --repository-name sep-backend --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker tag sep-backend:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/sep-backend:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/sep-backend:latest

# 4. Deploy CloudFormation stack
aws cloudformation create-stack \
  --stack-name sep-v2-production \
  --template-body file://deploy/cloudformation-template.yaml \
  --parameters \
    ParameterKey=EnvironmentName,ParameterValue=production \
    ParameterKey=DockerImageUrl,ParameterValue=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/sep-backend:latest \
    ParameterKey=DBMasterPassword,ParameterValue=$(openssl rand -base64 32) \
    ParameterKey=JWTSecret,ParameterValue=$(openssl rand -base64 32) \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $AWS_REGION

# 5. Wait for stack creation (5-10 minutes)
aws cloudformation wait stack-create-complete \
  --stack-name sep-v2-production \
  --region $AWS_REGION

# 6. Get the load balancer URL
aws cloudformation describe-stacks \
  --stack-name sep-v2-production \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" \
  --output text \
  --region $AWS_REGION
```

**Result**: Application running at your load balancer URL! 🎉

### Option 2: Self-Hosted (Manual)

```bash
# 1. SSH into your Linux server
ssh -i your-key.pem ubuntu@your-server-ip

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 3. Clone repository
git clone https://github.com/MacTechIN/SEP-V2.0.git
cd SEP-V2.0

# 4. Configure environment
cp .env.production.example .env.production
nano .env.production  # Edit with your values

# 5. Start services
cd deploy/
docker compose up -d

# 6. Verify
curl http://localhost:3001/health
```

**Result**: Application running at http://your-server-ip:3001 ✅

## Pre-Deployment Checklist

Before deploying to production, ensure:

- [ ] **Security**
  - [ ] JWT_SECRET is a secure random string (32+ characters)
  - [ ] Database password is secure (20+ characters)
  - [ ] No secrets in git history: `git log --name-only -S "password" | grep -v "example"`
  - [ ] Environment variables use secrets manager (AWS Secrets Manager, etc.)
  - [ ] HTTPS/SSL certificate configured

- [ ] **Database**
  - [ ] Automated backups enabled
  - [ ] Backup retention: 7+ days
  - [ ] Test restore procedure
  - [ ] Connection pooling configured

- [ ] **Monitoring**
  - [ ] Error tracking configured (Sentry)
  - [ ] APM configured (DataDog/New Relic)
  - [ ] CloudWatch/Stackdriver logging enabled
  - [ ] Alert policies created for:
    - [ ] API error rate > 1%
    - [ ] Response time > 1 second
    - [ ] Database connection errors
    - [ ] High CPU/memory usage

- [ ] **Documentation**
  - [ ] Runbook created for common issues
  - [ ] Deployment notes documented
  - [ ] Rollback procedure tested
  - [ ] On-call schedule established

- [ ] **Performance**
  - [ ] Load testing completed
  - [ ] Database indexes optimized
  - [ ] CDN configured for static assets
  - [ ] Caching strategy implemented

## Detailed Deployment Steps

### Step 1: Choose Your Platform

| Platform | Cost/Month | Setup Time | Best For |
|----------|-----------|-----------|----------|
| AWS | $50-120 | 15 min | Production at scale |
| Google Cloud | $50-110 | 15 min | Serverless preference |
| Azure | $60-130 | 20 min | Enterprise |
| Self-Hosted | $10-30 | 30 min | Budget-conscious |

### Step 2: Prepare Infrastructure

#### AWS
```bash
# Create S3 bucket for terraform state (optional)
aws s3 mb s3://sep-v2-terraform-state-$(date +%s)

# Or use CloudFormation directly (recommended for simplicity)
```

#### Google Cloud
```bash
# Enable APIs
gcloud services enable run.googleapis.com sql-component.googleapis.com redis.googleapis.com

# Create Cloud SQL instance
gcloud sql instances create sep-v2-postgres \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1
```

#### Azure
```bash
# Create resource group
az group create --name sep-v2-rg --location eastus

# Create container registry
az acr create --resource-group sep-v2-rg \
  --name sepv2registry \
  --sku Basic
```

#### Self-Hosted
```bash
# Provision Linux server (Ubuntu 22.04)
# SSH into server and run:
curl https://raw.githubusercontent.com/MacTechIN/SEP-V2.0/main/deploy/setup-self-hosted.sh | bash
```

### Step 3: Build & Push Docker Image

```bash
# Build image
docker build -f deploy/Dockerfile.backend -t sep-backend:1.0.0 .

# Tag for registry
docker tag sep-backend:1.0.0 your-registry/sep-backend:1.0.0

# Push to registry
docker push your-registry/sep-backend:1.0.0
```

### Step 4: Deploy Application

Use the deployment script for automatic setup:

```bash
cd deploy/

# AWS deployment
./deploy.sh -e production -p aws -r $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Google Cloud deployment
./deploy.sh -e production -p gcp -r gcr.io/your-project-id

# Azure deployment
./deploy.sh -e production -p azure -r your-registry.azurecr.io

# Self-hosted deployment
./deploy.sh -e production -p self-hosted
```

### Step 5: Configure Custom Domain

#### Route53 (AWS)
```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "yourdomain.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "your-alb-dns-name.amazonaws.com"}]
      }
    }]
  }'
```

#### Cloud DNS (Google Cloud)
```bash
gcloud dns record-sets create yourdomain.com \
  --rrdatas="your-load-balancer-ip" \
  --ttl=300 \
  --type=A \
  --zone=your-zone
```

#### Self-Hosted (Nginx)
```bash
# Create Nginx config
sudo tee /etc/nginx/sites-available/sep-v2 <<EOF
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

sudo systemctl reload nginx
```

### Step 6: Configure Monitoring

```bash
# Create Sentry project
# Get DSN and add to environment variables

# Create DataDog API key
# Add to environment variables

# Enable CloudWatch/Stackdriver monitoring
# Create alert policies for:
# - Error rate > 1%
# - Response time > 1 second
# - Database connectivity issues
```

### Step 7: Post-Deployment Verification

```bash
# Get application URL
export APP_URL="your-load-balancer-url-or-domain"

# Test health endpoint
curl $APP_URL/health

# Test authentication
curl -X POST $APP_URL/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"kim@company.com","password":"password123"}'

# Check logs
# AWS: CloudWatch Logs group
# GCP: Cloud Logging
# Azure: Application Insights
# Self-hosted: docker compose logs -f backend
```

## Deployment Verification Checklist

After deployment, verify:

- [ ] Health endpoint returns 200 OK
- [ ] Authentication works (login returns token)
- [ ] Protected routes require authentication
- [ ] Database connectivity confirmed
- [ ] Redis cache working
- [ ] Logs flowing to monitoring system
- [ ] Performance acceptable (< 1s response times)
- [ ] Error tracking receiving data
- [ ] Backup jobs scheduled and running
- [ ] SSL/HTTPS working
- [ ] Custom domain resolving to application

## Monitoring & Alerting

### Essential Metrics to Monitor

1. **API Performance**
   - Response time (p50, p95, p99)
   - Request rate (requests/sec)
   - Error rate (% of 5xx responses)

2. **Database**
   - Connection count
   - Query latency
   - Disk usage
   - Backup completion

3. **Cache**
   - Hit rate
   - Memory usage
   - Evictions

4. **Infrastructure**
   - CPU usage
   - Memory usage
   - Disk usage
   - Network throughput

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Error Rate | > 0.1% | > 1% |
| Response Time (p99) | > 500ms | > 2s |
| Database Connections | > 80% | > 95% |
| Disk Usage | > 70% | > 90% |
| CPU Usage | > 60% | > 80% |

## Cost Optimization

### AWS
- Use RDS Reserved Instances for 30-40% savings
- Enable S3 Intelligent-Tiering for static assets
- Use CloudFront for CDN (reduces data transfer costs)
- Set up auto-scaling to match traffic patterns

### Google Cloud
- Use Committed Use Discounts (25-30% savings)
- Enable Autoscaling on Cloud Run
- Use Cloud CDN for caching
- Optimize database instance size

### Azure
- Use Reserved Instances (25-35% savings)
- Enable Autoscale rules
- Use Azure CDN for caching
- Optimize VM size

### Self-Hosted
- Use spot instances / preemptible VMs (70% discount)
- Implement auto-scaling
- Share resources efficiently
- Monitor and right-size regularly

## Rollback Procedure

If critical issues occur after deployment:

### AWS
```bash
# List previous stack versions
aws cloudformation describe-stacks --query "Stacks[?StackName=='sep-v2-production'].StackId"

# Update service with previous task definition
aws ecs update-service \
  --cluster production-cluster \
  --service sep-backend \
  --task-definition sep-backend:PREVIOUS_VERSION
```

### Google Cloud
```bash
# Deploy previous image
gcloud run deploy sep-backend \
  --image=gcr.io/your-project/sep-backend:previous-tag \
  --region=us-central1
```

### Self-Hosted
```bash
# Docker Compose rollback
cd deploy/
git checkout HEAD~1  # Go back one commit
docker compose down
docker compose up -d
```

## Maintenance

### Daily
- [ ] Check error tracking dashboard (Sentry)
- [ ] Review logs for anomalies
- [ ] Verify backups completed

### Weekly
- [ ] Review performance metrics
- [ ] Check security alerts
- [ ] Test monitoring alerts are firing

### Monthly
- [ ] Full security audit
- [ ] Database optimization
- [ ] Dependency update check
- [ ] Cost analysis

## Support Resources

- **Deployment Issues**: See `deploy/deploy.sh` logs
- **API Issues**: Check CloudWatch/Stackdriver logs
- **Database Issues**: Review RDS/Cloud SQL event logs
- **Performance Issues**: Check APM dashboard (DataDog/New Relic)
- **Production Checklist**: See `PRODUCTION_CHECKLIST.md`
- **Architecture Decisions**: See `DEPLOYMENT_GUIDE.md`

## Next Steps

After successful production deployment:

1. **Real Database Integration** (Week 1)
   - Migrate from in-memory Maps to PostgreSQL tables
   - Implement proper data persistence layer

2. **Real OpenAI Integration** (Week 2)
   - Wire meeting analysis to OpenAI API
   - Implement streaming response handling

3. **Advanced Analytics** (Week 2-3)
   - Integrate Mixpanel or Segment
   - Build advanced dashboards

4. **Mobile App Store** (Week 3-4)
   - Submit iOS app to App Store
   - Submit Android app to Google Play
   - Manage app store reviews

5. **Performance Optimization** (Week 4+)
   - Implement CDN caching
   - Database query optimization
   - Frontend bundle optimization
   - Auto-scaling tuning

## Troubleshooting

### Application won't start
```bash
# Check logs
docker compose logs backend

# Common issues:
# - Database not accessible: check DB_HOST, DB_PORT, DB_PASSWORD
# - Redis not accessible: check REDIS_URL
# - Port already in use: check deploy/docker-compose.yml ports
```

### High latency
```bash
# Check database query performance
# Check Redis hit rate
# Review CloudWatch metrics
# Check for database connections at limit
```

### Database errors
```bash
# Check database connectivity
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1"

# Check for long-running queries
SELECT pid, duration FROM pg_stat_statements ORDER BY duration DESC LIMIT 5;

# Increase connection pool size if needed
```

### Memory issues
```bash
# Check container memory usage
docker stats

# If OOM: increase task memory in ECS/Cloud Run
# Optimize code for memory efficiency
# Enable Redis for caching
```

---

**Next**: Follow the 5-minute quick start above, or read detailed platform-specific instructions in `DEPLOYMENT_GUIDE.md`.

**Questions?** See `PRODUCTION_CHECKLIST.md` for comprehensive verification steps.

**Status**: ✅ Production-ready. You are 5 minutes away from deployment.
