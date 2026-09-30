"""
Bring up the AS2 stack for the disaster_site simulation.

Starts the Gazebo platform (with its sensor bridges), ground-truth state estimator,
speed PID motion controller, basic motion behaviors (takeoff, land, go_to, follow_path)
and RViz with the sensor displays.
Run launch_simulation.py first (and wait for the drone to show up in Gazebo).
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def _include(package: str, launch_file: str, arguments: dict):
    path = os.path.join(get_package_share_directory(package), 'launch', launch_file)
    return IncludeLaunchDescription(
        PythonLaunchDescriptionSource(path), launch_arguments=arguments.items())


def generate_launch_description():
    assets = get_package_share_directory('as2_gazebo_assets')
    namespace = LaunchConfiguration('namespace')
    common = {'namespace': namespace, 'use_sim_time': 'true'}

    return LaunchDescription([
        DeclareLaunchArgument('namespace', default_value='drone0'),
        DeclareLaunchArgument(
            'simulation_config_file',
            default_value=os.path.join(assets, 'config', 'disaster_site.json')),
        DeclareLaunchArgument(
            'rviz_config', default_value=os.path.join(assets, 'config', 'disaster_site.rviz')),
        DeclareLaunchArgument('rviz', default_value='true', choices=['true', 'false']),
        DeclareLaunchArgument('record', default_value='false', choices=['true', 'false'],
                              description='Archive every sensor to files under output_dir'),
        DeclareLaunchArgument(
            'recorder_config',
            default_value=os.path.join(assets, 'config', 'sensor_recorder.yaml')),
        DeclareLaunchArgument('output_dir', default_value='~/as2_recordings'),

        _include('as2_platform_gazebo', 'platform_gazebo_launch.py', {
            **common,
            'simulation_config_file': LaunchConfiguration('simulation_config_file')}),
        # The plugin config sets use_gazebo_tf, which hangs odom off the Gazebo model frame
        # (drone0) instead of drone0/base_link. Without it the Gazebo pose tree (which carries
        # every sensor frame) stays detached from earth and RViz cannot transform sensor data.
        _include('as2_state_estimator', 'state_estimator_launch.py', {
            **common, 'plugin_name': 'ground_truth',
            'plugin_config_file': os.path.join(
                assets, 'config', 'state_estimator_ground_truth.yaml')}),
        _include('as2_motion_controller', 'controller_launch.py', {
            **common, 'plugin_name': 'pid_speed_controller'}),
        _include('as2_behaviors_motion', 'motion_behaviors_launch.py', {
            **common,
            'takeoff_plugin_name': 'takeoff_plugin_speed',
            'land_plugin_name': 'land_plugin_speed',
            'go_to_plugin_name': 'go_to_plugin_position',
            'follow_path_plugin_name': 'follow_path_plugin_position'}),

        Node(
            condition=IfCondition(LaunchConfiguration('rviz')),
            package='rviz2', executable='rviz2', name='rviz2', output='screen',
            arguments=['-d', LaunchConfiguration('rviz_config')],
            parameters=[{'use_sim_time': True}]),

        Node(
            condition=IfCondition(LaunchConfiguration('record')),
            package='as2_gazebo_assets', executable='sensor_recorder',
            name='sensor_recorder', namespace=namespace, output='screen',
            parameters=[{
                'use_sim_time': True,
                'config_file': LaunchConfiguration('recorder_config'),
                'output_dir': LaunchConfiguration('output_dir'),
            }]),
    ])
