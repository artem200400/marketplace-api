import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config =
    new pulumi.Config()

const baseStackRef =
    config.require(
        'baseStackRef'
    )

const dbPassword =
    config.requireSecret(
        'dbPassword'
    )

const withNat =
    config.getBoolean(
        'withNat'
    ) ??
    false

const base =
    new pulumi.StackReference(
        baseStackRef
    )

const vpcId =
    base.getOutput(
        'vpcId'
    ) as
        pulumi.Output<string>

const publicSubnetIds =
    base.getOutput(
        'publicSubnetIds'
    ) as
        pulumi.Output<string[]>

const privateSubnetIds =
    base.getOutput(
        'privateSubnetIds'
    ) as
        pulumi.Output<string[]>

const privateRouteTableId =
    base.getOutput(
        'privateRouteTableId'
    ) as
        pulumi.Output<string>

const albSecurityGroupId =
    base.getOutput(
        'albSecurityGroupId'
    ) as
        pulumi.Output<string>

const rdsSecurityGroupId =
    base.getOutput(
        'rdsSecurityGroupId'
    ) as
        pulumi.Output<string>

/*
 * RDS destroy safety:
 * - deletionProtection=false
 * - skipFinalSnapshot=true
 *
 * This prevents a forgotten final snapshot or deletion protection
 * from surviving pulumi destroy and continuing to cost money.
 */
const dbSubnetGroup =
    new aws.rds.SubnetGroup(
        'hw31-db-subnets',
        {
            subnetIds:
                privateSubnetIds
        }
    )

const database =
    new aws.rds.Instance(
        'hw31-postgres',
        {
            identifier:
                'nodejs-pro-hw31',

            engine:
                'postgres',

            instanceClass:
                'db.t4g.micro',

            allocatedStorage:
                20,

            storageType:
                'gp3',

            storageEncrypted:
                true,

            multiAz:
                true,

            backupRetentionPeriod:
                1,

            dbSubnetGroupName:
                dbSubnetGroup.name,

            vpcSecurityGroupIds: [
                rdsSecurityGroupId
            ],

            publiclyAccessible:
                false,

            username:
                'marketplace',

            password:
                dbPassword,

            deletionProtection:
                false,

            skipFinalSnapshot:
                true,

            applyImmediately:
                true
        }
    )

const lambdaRole =
    new aws.iam.Role(
        'hw31-lambda-role',
        {
            assumeRolePolicy:
                JSON.stringify({
                    Version:
                        '2012-10-17',

                    Statement: [
                        {
                            Effect:
                                'Allow',

                            Principal: {
                                Service:
                                    'lambda.amazonaws.com'
                            },

                            Action:
                                'sts:AssumeRole'
                        }
                    ]
                })
        }
    )

new aws.iam.RolePolicy(
    'hw31-lambda-logs',
    {
        role:
            lambdaRole.id,

        policy:
            JSON.stringify({
                Version:
                    '2012-10-17',

                Statement: [
                    {
                        Effect:
                            'Allow',

                        Action: [
                            'logs:CreateLogGroup',
                            'logs:CreateLogStream',
                            'logs:PutLogEvents'
                        ],

                        Resource:
                            'arn:aws:logs:*:*:*'
                    }
                ]
            })
    }
)

const lambdaCode =
    new pulumi.asset.AssetArchive({
        'index.mjs':
            new pulumi.asset.StringAsset(
                `
                export async function handler() {
                    return {
                        statusCode: 200,
                        statusDescription: '200 OK',
                        isBase64Encoded: false,
                        headers: {
                            'content-type': 'application/json'
                        },
                        body: JSON.stringify({
                            status: 'ok',
                            source: 'hw31-alb-lambda'
                        })
                    }
                }
                `
            )
    })

const targetLambda =
    new aws.lambda.Function(
        'hw31-target',
        {
            role:
                lambdaRole.arn,

            runtime:
                'nodejs22.x',

            handler:
                'index.handler',

            code:
                lambdaCode,

            timeout:
                5
        }
    )

const targetGroup =
    new aws.lb.TargetGroup(
        'hw31-target-group',
        {
            targetType:
                'lambda',

            healthCheck: {
                enabled:
                    true,

                interval:
                    35,

                timeout:
                    30,

                healthyThreshold:
                    2,

                unhealthyThreshold:
                    2
            }
        }
    )

const invokePermission =
    new aws.lambda.Permission(
        'hw31-alb-invoke',
        {
            action:
                'lambda:InvokeFunction',

            function:
                targetLambda.name,

            principal:
                'elasticloadbalancing.amazonaws.com',

            sourceArn:
                targetGroup.arn
        }
    )

new aws.lb.TargetGroupAttachment(
    'hw31-target-attachment',
    {
        targetGroupArn:
            targetGroup.arn,

        targetId:
            targetLambda.arn
    },
    {
        dependsOn: [
            invokePermission
        ]
    }
)

const loadBalancer =
    new aws.lb.LoadBalancer(
        'hw31-alb',
        {
            internal:
                false,

            loadBalancerType:
                'application',

            securityGroups: [
                albSecurityGroupId
            ],

            subnets:
                publicSubnetIds
        }
    )

new aws.lb.Listener(
    'hw31-http-listener',
    {
        loadBalancerArn:
            loadBalancer.arn,

        port:
            80,

        protocol:
            'HTTP',

        defaultActions: [
            {
                type:
                    'forward',

                targetGroupArn:
                    targetGroup.arn
            }
        ]
    }
)

let natGateway:
    aws.ec2.NatGateway |
    undefined

let natEip:
    aws.ec2.Eip |
    undefined

if (withNat) {
    natEip =
        new aws.ec2.Eip(
            'hw31-nat-eip',
            {
                domain:
                    'vpc'
            }
        )

    natGateway =
        new aws.ec2.NatGateway(
            'hw31-nat',
            {
                allocationId:
                    natEip.id,

                subnetId:
                    publicSubnetIds
                        .apply(
                            ids =>
                                ids[0]
                        )
            }
        )

    new aws.ec2.Route(
        'hw31-private-default-via-nat',
        {
            routeTableId:
                privateRouteTableId,

            destinationCidrBlock:
                '0.0.0.0/0',

            natGatewayId:
                natGateway.id
        }
    )
}

export const dbIdentifier =
    database.identifier

export const dbAvailabilityZone =
    database.availabilityZone

export const albDns =
    loadBalancer.dnsName

export const targetGroupArn =
    targetGroup.arn

export const natGatewayId =
    natGateway?.id ??
    pulumi.output('')

export const natEipAllocationId =
    natEip?.id ??
    pulumi.output('')

export const demoVpcId =
    vpcId
