import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const appDbPassword = requiredEnv('APP_DB_PASSWORD')
const authJwtSecret = requiredEnv('AUTH_JWT_SECRET')
if (Buffer.byteLength(authJwtSecret) < 32) {
  throw new Error('AUTH_JWT_SECRET must be at least 32 bytes')
}

const namespace = new k8s.core.v1.Namespace('marketplace-hw28-ns', {
  metadata: {
    name: 'marketplace-hw28'
  }
})

const appSecret = new k8s.core.v1.Secret('marketplace-runtime-secret', {
  metadata: {
    namespace: namespace.metadata.name,
    name: 'marketplace-runtime'
  },
  type: 'Opaque',
  data: {
    APP_DB_PASSWORD: Buffer.from(appDbPassword).toString('base64'),
    AUTH_JWT_SECRET: pulumi.secret(Buffer.from(authJwtSecret).toString('base64'))
  }
})

const labels = {
  app: 'marketplace-api'
}

const deployment = new k8s.apps.v1.Deployment('marketplace-api', {
  metadata: {
    namespace: namespace.metadata.name,
    name: 'marketplace-api'
  },
  spec: {
    replicas: 3,
    strategy: {
      type: 'RollingUpdate',
      rollingUpdate: {
        maxUnavailable: 0,
        maxSurge: 1
      }
    },
    selector: {
      matchLabels: labels
    },
    template: {
      metadata: {
        labels,
        annotations: {
          revision: process.env.REV ?? 'initial'
        }
      },
      spec: {
        terminationGracePeriodSeconds: 12,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 65532,
          runAsGroup: 65532,
          fsGroup: 65532
        },
        containers: [{
          name: 'api',
          image: process.env.APP_IMAGE ?? 'marketplace-api:hw28',
          imagePullPolicy: 'IfNotPresent',
          ports: [{
            containerPort: 3000,
            name: 'http'
          }],
          env: [
            { name: 'PORT', value: '3000' },
            { name: 'APP_WARMUP_MS', value: '4000' },
            { name: 'APP_DRAIN_MS', value: '5000' },
            { name: 'DB_HOST', value: '127.0.0.1' },
            { name: 'DB_PORT', value: '5432' },
            { name: 'DB_NAME', value: 'marketplace' },
            { name: 'DB_USER', value: 'marketplace' },
            { name: 'DB_PASSWORD_FILE', value: '/tmp/db-password-not-used' },
            { name: 'DB_URL', value: 'postgresql://marketplace@127.0.0.1:5432/marketplace' },
            {
              name: 'AUTH_JWT_SECRET',
              valueFrom: {
                secretKeyRef: {
                  name: appSecret.metadata.name,
                  key: 'AUTH_JWT_SECRET'
                }
              }
            },
            {
              name: 'APP_DB_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: appSecret.metadata.name,
                  key: 'APP_DB_PASSWORD'
                }
              }
            }
          ],
          readinessProbe: {
            httpGet: {
              path: '/readyz',
              port: 'http'
            },
            periodSeconds: 1,
            timeoutSeconds: 1,
            failureThreshold: 1,
            successThreshold: 1
          },
          livenessProbe: {
            httpGet: {
              path: '/healthz',
              port: 'http'
            },
            initialDelaySeconds: 8,
            periodSeconds: 5,
            timeoutSeconds: 1,
            failureThreshold: 3
          },
          resources: {
            requests: {
              cpu: '50m',
              memory: '96Mi'
            },
            limits: {
              cpu: '500m',
              memory: '256Mi'
            }
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: {
              drop: ['ALL']
            }
          }
        }]
      }
    }
  }
}, { dependsOn: appSecret })

const service = new k8s.core.v1.Service('marketplace-api-service', {
  metadata: {
    namespace: namespace.metadata.name,
    name: 'marketplace-api'
  },
  spec: {
    type: 'NodePort',
    selector: labels,
    ports: [{
      name: 'http',
      port: 80,
      targetPort: 'http',
      nodePort: 30080
    }]
  }
})

const pdb = new k8s.policy.v1.PodDisruptionBudget('marketplace-api-pdb', {
  metadata: {
    namespace: namespace.metadata.name,
    name: 'marketplace-api'
  },
  spec: {
    minAvailable: 2,
    selector: {
      matchLabels: labels
    }
  }
})

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler('marketplace-api-hpa', {
  metadata: {
    namespace: namespace.metadata.name,
    name: 'marketplace-api'
  },
  spec: {
    minReplicas: 2,
    maxReplicas: 5,
    scaleTargetRef: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: deployment.metadata.name
    },
    metrics: [{
      type: 'Resource',
      resource: {
        name: 'cpu',
        target: {
          type: 'Utilization',
          averageUtilization: 70
        }
      }
    }]
  }
})

export const namespaceName = namespace.metadata.name
export const serviceName = service.metadata.name
export const pdbName = pdb.metadata.name
export const hpaName = hpa.metadata.name
export const deploymentName = deployment.metadata.name
export const secretName = appSecret.metadata.name
export const image = process.env.APP_IMAGE ?? 'marketplace-api:hw28'
export const nodePort = pulumi.output(30080)
