import paramiko
import sys

hostname = '<redacted-host>'
port = 22
username = 'user'
password = '<redacted!>'

def execute_command(ssh, command):
    stdin, stdout, stderr = ssh.exec_command(command)
    output = stdout.read().decode()
    error = stderr.read().decode()
    return output, error

try:
    # 创建SSH客户端
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"正在连接到 {hostname}...")
    ssh.connect(hostname, port=port, username=username, password=password,
                allow_agent=False, look_for_keys=False)
    print("连接成功！输入命令执行，输入 'exit' 退出\n")
    
    # 交互式shell
    while True:
        # 获取当前目录
        stdin, stdout, stderr = ssh.exec_command('pwd')
        current_dir = stdout.read().decode().strip()
        
        cmd = input(f"root@{hostname}:{current_dir}$ ")
        
        if cmd.lower() == 'exit':
            break
        
        if cmd.strip() == '':
            continue
            
        output, error = execute_command(ssh, cmd)
        
        if output:
            print(output)
        if error:
            print("错误:", error, file=sys.stderr)
    
    ssh.close()
    print("\n连接已关闭")
    
except Exception as e:
    print(f"错误: {str(e)}")
    sys.exit(1)
