import paramiko
import sys

hostname = '<redacted-host>'
port = 22
username = 'user'
password = '<redacted!>'

try:
    # 创建SSH客户端
    ssh = paramiko.SSHClient()
    
    # 自动添加主机密钥
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"正在连接到 {hostname}...")
    
    # 连接SSH服务器
    ssh.connect(hostname, port=port, username=username, password=password, 
                timeout=30,
                allow_agent=False,
                look_for_keys=False)
    
    print("连接成功！")
    print(f"已登录到: {username}@{hostname}")
    
    # 执行一个简单的命令来验证连接
    stdin, stdout, stderr = ssh.exec_command('whoami && uptime')
    print("\n命令输出:")
    print(stdout.read().decode())
    
    # 关闭连接
    ssh.close()
    print("\n连接已关闭")
    
except paramiko.AuthenticationException:
    print("认证失败：用户名或密码错误")
    sys.exit(1)
except paramiko.SSHException as e:
    print(f"SSH连接错误: {str(e)}")
    sys.exit(1)
except Exception as e:
    print(f"连接失败: {str(e)}")
    sys.exit(1)
