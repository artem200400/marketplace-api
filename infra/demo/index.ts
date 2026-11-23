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

const targetSecurityGroup =
    new aws.ec2.SecurityGroup(
        'hw31-target-sg',
        {
            vpcId,

            description:
                'HW31 EC2 target security group',

            ingress: [
                {
                    protocol:
                        'tcp',

                    fromPort:
                        80,

                    toPort:
                        80,

                    securityGroups: [
                        albSecurityGroupId
                    ]
                }
            ],

            egress: [
                {
                    protocol:
                        '-1',

                    fromPort:
                        0,

                    toPort:
                        0,

                    cidrBlocks: [
                        '0.0.0.0/0'
                    ]
                }
            ]
        }
    )

const targetAmi =
    aws.ec2.getAmiOutput({
        mostRecent:
            true,

        owners: [
            'amazon'
        ],

        filters: [
            {
                name:
                    'name',

                values: [
                    'al2023-ami-2023*-kernel-6.1-arm64'
                ]
            },
            {
                name:
                    'architecture',

                values: [
                    'arm64'
                ]
            },
            {
                name:
                    'root-device-type',

                values: [
                    'ebs'
                ]
            }
        ]
    })

const targetInstance =
    new aws.ec2.Instance(
        'hw31-target',
        {
            ami:
                targetAmi.id,

            instanceType:
                't4g.micro',

            subnetId:
                publicSubnetIds.apply(
                    ids =>
                        ids[0]
                ),

            associatePublicIpAddress:
                true,

            vpcSecurityGroupIds: [
                targetSecurityGroup.id
            ],

            userData:
                `#!/bin/bash
set -eux
dnf install -y httpd
cat > /var/www/html/index.html <<'EOF'
{"status":"ok","source":"hw31-alb-ec2"}
EOF
systemctl enable --now httpd
`
        }
    )

const targetGroup =
    new aws.lb.TargetGroup(
        'hw31-target-group',
        {
            vpcId,

            port:
                80,

            protocol:
                'HTTP',

            targetType:
                'instance',

            healthCheck: {
                enabled:
                    true,

                path:
                    '/',

                protocol:
                    'HTTP',

                matcher:
                    '200',

                interval:
                    15,

                timeout:
                    5,

                healthyThreshold:
                    2,

                unhealthyThreshold:
                    2
            }
        }
    )

new aws.lb.TargetGroupAttachment(
    'hw31-target-attachment',
    {
        targetGroupArn:
            targetGroup.arn,

        targetId:
            targetInstance.id,

        port:
            80
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
