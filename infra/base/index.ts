import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config =
    new pulumi.Config()

const budgetEmail =
    config.get(
        'budgetEmail'
    ) ??
    process.env.HW31_BUDGET_EMAIL ??
    'hw31-budget@example.invalid'

const repo =
    'artem200400/marketplace-api'

/*
 * HW31 rule: the budget is intentionally the first AWS
 * resource declared in this program, before VPC/networking.
 * limitAmount: 5 USD
 * notificationType: ACTUAL
 * FORECASTED is intentionally not used.
 */
const budget =
    new aws.budgets.Budget(
        'hw31-budget',
        {
            budgetType:
                'COST',

            timeUnit:
                'MONTHLY',

            limitAmount:
                '5',

            limitUnit:
                'USD',

            notifications: [
                {
                    comparisonOperator:
                        'GREATER_THAN',

                    notificationType:
                        'ACTUAL',

                    threshold:
                        20,

                    thresholdType:
                        'PERCENTAGE',

                    subscriberEmailAddresses: [
                        budgetEmail
                    ]
                }
            ]
        }
    )

const zones =
    aws.getAvailabilityZonesOutput({
        state: 'available'
    })

const vpc =
    new aws.ec2.Vpc(
        'hw31-vpc',
        {
            cidrBlock:
                '10.31.0.0/16',

            enableDnsHostnames:
                true,

            enableDnsSupport:
                true
        },
        {
            dependsOn: [
                budget
            ]
        }
    )

const internetGateway =
    new aws.ec2.InternetGateway(
        'hw31-igw',
        {
            vpcId:
                vpc.id
        }
    )

const publicSubnets =
    [
        new aws.ec2.Subnet(
            'hw31-public-a',
            {
                vpcId:
                    vpc.id,

                cidrBlock:
                    '10.31.0.0/24',

                availabilityZone:
                    zones.names[0],

                mapPublicIpOnLaunch:
                    true
            }
        ),

        new aws.ec2.Subnet(
            'hw31-public-b',
            {
                vpcId:
                    vpc.id,

                cidrBlock:
                    '10.31.1.0/24',

                availabilityZone:
                    zones.names[1],

                mapPublicIpOnLaunch:
                    true
            }
        )
    ]

const privateSubnets =
    [
        new aws.ec2.Subnet(
            'hw31-private-a',
            {
                vpcId:
                    vpc.id,

                cidrBlock:
                    '10.31.10.0/24',

                availabilityZone:
                    zones.names[0],

                mapPublicIpOnLaunch:
                    false
            }
        ),

        new aws.ec2.Subnet(
            'hw31-private-b',
            {
                vpcId:
                    vpc.id,

                cidrBlock:
                    '10.31.11.0/24',

                availabilityZone:
                    zones.names[1],

                mapPublicIpOnLaunch:
                    false
            }
        )
    ]

const publicRouteTable =
    new aws.ec2.RouteTable(
        'hw31-public-rt',
        {
            vpcId:
                vpc.id,

            routes: [
                {
                    cidrBlock:
                        '0.0.0.0/0',

                    gatewayId:
                        internetGateway.id
                }
            ]
        }
    )

for (
    const [
        index,
        subnet
    ]
    of publicSubnets.entries()
) {
    new aws.ec2.RouteTableAssociation(
        `hw31-public-rta-${index}`,
        {
            routeTableId:
                publicRouteTable.id,

            subnetId:
                subnet.id
        }
    )
}

/*
 * Private route table deliberately has no 0.0.0.0/0 route
 * to the Internet Gateway. RDS does not need Internet egress.
 */
const privateRouteTable =
    new aws.ec2.RouteTable(
        'hw31-private-rt',
        {
            vpcId:
                vpc.id
        }
    )

for (
    const [
        index,
        subnet
    ]
    of privateSubnets.entries()
) {
    new aws.ec2.RouteTableAssociation(
        `hw31-private-rta-${index}`,
        {
            routeTableId:
                privateRouteTable.id,

            subnetId:
                subnet.id
        }
    )
}

/*
 * ALB ingress: HTTP/80 is public because the homework requires
 * an internet-facing ALB that can be verified from outside AWS.
 */
const albSecurityGroup =
    new aws.ec2.SecurityGroup(
        'hw31-alb-sg',
        {
            vpcId:
                vpc.id,

            description:
                'HW31 public ALB security group',

            ingress: [
                {
                    protocol:
                        'tcp',

                    fromPort:
                        80,

                    toPort:
                        80,

                    cidrBlocks: [
                        '0.0.0.0/0'
                    ],

                    description:
                        'Public HTTP for ALB demo'
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

/*
 * RDS ingress: PostgreSQL/5432 is allowed only from resources
 * carrying the ALB/application security group, never from Internet.
 */
const rdsSecurityGroup =
    new aws.ec2.SecurityGroup(
        'hw31-rds-sg',
        {
            vpcId:
                vpc.id,

            description:
                'HW31 private PostgreSQL security group',

            ingress: [
                {
                    protocol:
                        'tcp',

                    fromPort:
                        5432,

                    toPort:
                        5432,

                    securityGroups: [
                        albSecurityGroup.id
                    ],

                    description:
                        'PostgreSQL only from application SG'
                }
            ]
        }
    )

const githubOidc =
    new aws.iam.OpenIdConnectProvider(
        'github-actions-oidc',
        {
            url:
                'https://token.actions.githubusercontent.com',

            clientIdLists: [
                'sts.amazonaws.com'
            ],

            thumbprintLists: [
                '6938fd4d98bab03faadb97b34396831e3780aea1'
            ]
        }
    )

const teardownRole =
    new aws.iam.Role(
        'hw31-teardown-role',
        {
            assumeRolePolicy:
                pulumi
                    .all([
                        githubOidc.arn
                    ])
                    .apply(
                        ([
                            oidcArn
                        ]) =>
                            JSON.stringify({
                                Version:
                                    '2012-10-17',

                                Statement: [
                                    {
                                        Effect:
                                            'Allow',

                                        Principal: {
                                            Federated:
                                                oidcArn
                                        },

                                        Action:
                                            'sts:AssumeRoleWithWebIdentity',

                                        Condition: {
                                            StringEquals: {
                                                'token.actions.githubusercontent.com:aud':
                                                    'sts.amazonaws.com'
                                            },

                                            StringLike: {
                                                'token.actions.githubusercontent.com:sub':
                                                    `repo:${repo}:*`
                                            }
                                        }
                                    }
                                ]
                            })
                    )
        }
    )

/*
 * No wildcard Action entries. These permissions are limited to
 * services that teardown/evidence uses:
 * - EC2/VPC networking and NAT/EIP lifecycle
 * - ELBv2 ALB/TG/listener lifecycle
 * - RDS instance/subnet-group lifecycle + failover/event reads
 * - Resource Groups Tagging API for post-destroy tail checks
 * - IAM role/policy simulation for the required positive/negative test
 * - Budgets read/write for the $5 guardrail
 */
const teardownPolicy =
    new aws.iam.RolePolicy(
        'hw31-teardown-policy',
        {
            role:
                teardownRole.id,

            policy:
                JSON.stringify({
                    Version:
                        '2012-10-17',

                    Statement: [
                        {
                            Effect:
                                'Allow',

                            Action: [
                                'ec2:AllocateAddress',
                                'ec2:AssociateRouteTable',
                                'ec2:AttachInternetGateway',
                                'ec2:CreateInternetGateway',
                                'ec2:CreateNatGateway',
                                'ec2:CreateRoute',
                                'ec2:CreateRouteTable',
                                'ec2:CreateSecurityGroup',
                                'ec2:CreateSubnet',
                                'ec2:CreateTags',
                                'ec2:CreateVpc',
                                'ec2:DeleteInternetGateway',
                                'ec2:DeleteNatGateway',
                                'ec2:DeleteRoute',
                                'ec2:DeleteRouteTable',
                                'ec2:DeleteSecurityGroup',
                                'ec2:DeleteSubnet',
                                'ec2:DeleteVpc',
                                'ec2:DescribeAddresses',
                                'ec2:DescribeAvailabilityZones',
                                'ec2:DescribeImages',
                                'ec2:DescribeInstances',
                                'ec2:DescribeInternetGateways',
                                'ec2:DescribeNatGateways',
                                'ec2:DescribeRouteTables',
                                'ec2:DescribeSecurityGroups',
                                'ec2:DescribeSubnets',
                                'ec2:DescribeVpcs',
                                'ec2:DetachInternetGateway',
                                'ec2:DisassociateAddress',
                                'ec2:DisassociateRouteTable',
                                'ec2:ReleaseAddress',
                                'ec2:RunInstances',
                                'ec2:TerminateInstances',

                                'elasticloadbalancing:AddTags',
                                'elasticloadbalancing:CreateListener',
                                'elasticloadbalancing:CreateLoadBalancer',
                                'elasticloadbalancing:CreateTargetGroup',
                                'elasticloadbalancing:DeleteListener',
                                'elasticloadbalancing:DeleteLoadBalancer',
                                'elasticloadbalancing:DeleteTargetGroup',
                                'elasticloadbalancing:DeregisterTargets',
                                'elasticloadbalancing:DescribeListeners',
                                'elasticloadbalancing:DescribeLoadBalancers',
                                'elasticloadbalancing:DescribeTargetHealth',
                                'elasticloadbalancing:DescribeTargetGroups',
                                'elasticloadbalancing:ModifyTargetGroup',
                                'elasticloadbalancing:RegisterTargets',

                                'rds:AddTagsToResource',
                                'rds:CreateDBInstance',
                                'rds:CreateDBSubnetGroup',
                                'rds:DeleteDBInstance',
                                'rds:DeleteDBSubnetGroup',
                                'rds:DescribeDBEvents',
                                'rds:DescribeDBInstances',
                                'rds:DescribeDBSubnetGroups',
                                'rds:ListTagsForResource',
                                'rds:ModifyDBInstance',
                                'rds:RebootDBInstance',

                                'tag:GetResources',

                                'iam:CreateOpenIDConnectProvider',
                                'iam:CreateRole',
                                'iam:DeleteOpenIDConnectProvider',
                                'iam:DeleteRole',
                                'iam:DeleteRolePolicy',
                                'iam:GetOpenIDConnectProvider',
                                'iam:GetRole',
                                'iam:GetRolePolicy',
                                'iam:ListAttachedRolePolicies',
                                'iam:ListRolePolicies',
                                'iam:PutRolePolicy',
                                'iam:SimulatePrincipalPolicy',
                                'iam:TagOpenIDConnectProvider',
                                'iam:TagRole',
                                'iam:UntagOpenIDConnectProvider',
                                'iam:UntagRole',

                                'lambda:AddPermission',
                                'lambda:CreateFunction',
                                'lambda:DeleteFunction',
                                'lambda:GetFunction',
                                'lambda:GetFunctionConfiguration',
                                'lambda:GetPolicy',
                                'lambda:ListVersionsByFunction',
                                'lambda:RemovePermission',
                                'lambda:TagResource',
                                'lambda:UntagResource',
                                'lambda:UpdateFunctionCode',
                                'lambda:UpdateFunctionConfiguration',

                                'logs:CreateLogGroup',
                                'logs:DeleteLogGroup',
                                'logs:DescribeLogGroups',
                                'logs:ListTagsForResource',
                                'logs:TagResource',
                                'logs:UntagResource',

                                'budgets:CreateBudget',
                                'budgets:DeleteBudget',
                                'budgets:DescribeBudget',
                                'budgets:ModifyBudget'
                            ],

                            Resource:
                                '*'
                        }
                    ]
                })
        }
    )

export const vpcId =
    vpc.id

export const publicSubnetIds =
    publicSubnets
        .map(
            subnet =>
                subnet.id
        )

export const privateSubnetIds =
    privateSubnets
        .map(
            subnet =>
                subnet.id
        )

export const privateRouteTableId =
    privateRouteTable.id

export const albSecurityGroupId =
    albSecurityGroup.id

export const rdsSecurityGroupId =
    rdsSecurityGroup.id

export const teardownRoleArn =
    teardownRole.arn

export const teardownRoleName =
    teardownRole.name

export const teardownPolicyName =
    teardownPolicy.name
